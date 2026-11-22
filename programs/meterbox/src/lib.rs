//! MeterBox channel: deposit SOL, accept cumulative Ed25519 vouchers, settle once.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    sysvar::instructions::{
        load_current_index_checked, load_instruction_at_checked, ID as INSTRUCTIONS_ID,
    },
};

declare_id!("Ga2tqUHwpZBCK26AJjcYsUoA4JtLzuRmMZkn72WdR1jz");

pub const VOUCHER_PREFIX: &[u8] = b"METERBOX_VOUCHER_V1";

#[program]
pub mod meterbox {
    use super::*;

    pub fn open_channel(
        ctx: Context<OpenChannel>,
        channel_id: u64,
        agent: Pubkey,
        deposit: u64,
        spending_limit: u64,
        expires_at: i64,
    ) -> Result<()> {
        require!(deposit > 0, MeterboxError::InvalidDeposit);
        require!(spending_limit <= deposit, MeterboxError::ExceedsDeposit);
        require!(
            expires_at > Clock::get()?.unix_timestamp,
            MeterboxError::InvalidExpiry
        );
        let channel = &mut ctx.accounts.channel;
        channel.payer = ctx.accounts.payer.key();
        channel.payee = ctx.accounts.payee.key();
        channel.agent = agent;
        channel.channel_id = channel_id;
        channel.deposit = deposit;
        channel.spending_limit = spending_limit;
        channel.settled = 0;
        channel.last_nonce = 0;
        channel.expires_at = expires_at;
        channel.bump = ctx.bumps.channel;
        let cpi = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: channel.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi, deposit)?;
        emit!(ChannelOpened {
            channel: channel.key(),
            payer: channel.payer,
            payee: channel.payee,
            agent: channel.agent,
            deposit,
            spending_limit,
            expires_at,
        });
        Ok(())
    }

    /// Pay `cumulative - settled` to the payee after verifying the agent voucher.
    pub fn settle(ctx: Context<Settle>, cumulative_amount: u64, nonce: u64) -> Result<()> {
        let channel_address = ctx.accounts.channel.key();
        let payee = ctx.accounts.payee.key();
        let channel = &mut ctx.accounts.channel;
        require!(nonce > channel.last_nonce, MeterboxError::NonceTooLow);
        require!(cumulative_amount > channel.settled, MeterboxError::AmountNotIncreasing);
        require!(cumulative_amount <= channel.spending_limit, MeterboxError::ExceedsLimit);
        require!(cumulative_amount <= channel.deposit, MeterboxError::ExceedsDeposit);

        verify_voucher(ctx.accounts.instructions_sysvar.as_ref(), channel, channel_address, payee, cumulative_amount, nonce)?;

        let delta = cumulative_amount
            .checked_sub(channel.settled)
            .ok_or(MeterboxError::MathOverflow)?;
        let remaining = channel
            .to_account_info()
            .lamports()
            .checked_sub(delta)
            .ok_or(MeterboxError::MathOverflow)?;
        require!(
            remaining >= ctx.accounts.rent.minimum_balance(channel.to_account_info().data_len()),
            MeterboxError::RentMinimumExceeded
        );
        **channel.to_account_info().try_borrow_mut_lamports()? = remaining;
        **ctx.accounts.payee.to_account_info().try_borrow_mut_lamports()? = ctx
            .accounts
            .payee
            .to_account_info()
            .lamports()
            .checked_add(delta)
            .ok_or(MeterboxError::MathOverflow)?;
        channel.settled = cumulative_amount;
        channel.last_nonce = nonce;
        emit!(Settled {
            channel: channel.key(),
            delta,
            cumulative: cumulative_amount,
            nonce,
        });
        Ok(())
    }

    pub fn close_channel(ctx: Context<CloseChannel>) -> Result<()> {
        let channel = &ctx.accounts.channel;
        let clock = Clock::get()?;
        let cooperative = ctx.accounts.payee_signer.is_some()
            && ctx.accounts.payee_signer.as_ref().unwrap().key() == channel.payee;
        let expired = clock.unix_timestamp >= channel.expires_at;
        require!(
            cooperative
                || (ctx.accounts.payer_signer.is_some()
                    && ctx.accounts.payer_signer.as_ref().unwrap().key() == channel.payer
                    && expired),
            MeterboxError::ChannelNotClosable
        );
        emit!(ChannelClosed {
            channel: channel.key(),
            payer: channel.payer,
            payee: channel.payee,
        });
        Ok(())
    }
}

fn verify_voucher(
    instructions: &AccountInfo,
    channel: &Channel,
    channel_address: Pubkey,
    payee: Pubkey,
    cumulative_amount: u64,
    nonce: u64,
) -> Result<()> {
    require!(instructions.key() == INSTRUCTIONS_ID, MeterboxError::MissingEd25519Instruction);
    let current_index = load_current_index_checked(instructions)?;
    require!(current_index > 0, MeterboxError::MissingEd25519Instruction);
    let ix = load_instruction_at_checked(
        current_index as usize - 1,
        instructions,
    )?;
    require!(ix.program_id == ed25519_program::ID, MeterboxError::MissingEd25519Instruction);
    let data = ix.data;
    require!(data.len() >= 2 + 7 * 2, MeterboxError::MalformedEd25519Instruction);
    require!(data[0] == 1, MeterboxError::MalformedEd25519Instruction);
    let signature_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
    let signature_instruction_index = u16::from_le_bytes([data[4], data[5]]);
    let public_key_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let public_key_instruction_index = u16::from_le_bytes([data[8], data[9]]);
    let message_data_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let message_data_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let message_instruction_index = u16::from_le_bytes([data[14], data[15]]);
    require!(
        signature_instruction_index == u16::MAX
            && public_key_instruction_index == u16::MAX
            && message_instruction_index == u16::MAX,
        MeterboxError::Ed25519ExternalData
    );
    require!(signature_offset + 64 <= data.len(), MeterboxError::MalformedEd25519Instruction);
    let key_start = public_key_offset;
    require!(key_start + 32 <= data.len(), MeterboxError::MalformedEd25519Instruction);
    let key_bytes: [u8; 32] = data[key_start..key_start + 32].try_into().unwrap();
    require!(Pubkey::new_from_array(key_bytes) == channel.agent, MeterboxError::VoucherAgentMismatch);
    let msg_start = message_data_offset;
    require!(msg_start + message_data_size <= data.len(), MeterboxError::MalformedEd25519Instruction);
    let mut expected = Vec::with_capacity(19 + 32 + 32 + 32 + 8 + 8);
    expected.extend_from_slice(VOUCHER_PREFIX);
    expected.extend_from_slice(crate::ID.as_ref());
    expected.extend_from_slice(&channel_address.to_bytes());
    expected.extend_from_slice(payee.as_ref());
    expected.extend_from_slice(&cumulative_amount.to_le_bytes());
    expected.extend_from_slice(&nonce.to_le_bytes());
    require!(data[msg_start..msg_start + message_data_size] == expected, MeterboxError::VoucherMismatch);
    Ok(())
}

#[derive(Accounts)]
#[instruction(channel_id: u64)]
pub struct OpenChannel<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: stored payee
    pub payee: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1,
        seeds = [b"channel", payer.key().as_ref(), payee.key().as_ref(), &channel_id.to_le_bytes()],
        bump
    )]
    pub channel: Account<'info, Channel>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub payee: Signer<'info>,
    #[account(
        mut,
        seeds = [b"channel", channel.payer.as_ref(), channel.payee.as_ref(), &channel.channel_id.to_le_bytes()],
        bump = channel.bump,
        has_one = payee
    )]
    pub channel: Account<'info, Channel>,
    /// CHECK: Verified against anchor_lang::solana_program::sysvar::instructions::ID
    #[account(address = INSTRUCTIONS_ID)]
    pub instructions_sysvar: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CloseChannel<'info> {
    /// CHECK: Destination receives the channel rent and remaining lamports.
    #[account(mut)]
    pub payer: AccountInfo<'info>,
    pub payer_signer: Option<Signer<'info>>,
    pub payee_signer: Option<Signer<'info>>,
    #[account(
        mut,
        close = payer,
        seeds = [b"channel", channel.payer.as_ref(), channel.payee.as_ref(), &channel.channel_id.to_le_bytes()],
        bump = channel.bump,
    )]
    pub channel: Account<'info, Channel>,
}

#[account]
pub struct Channel {
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub agent: Pubkey,
    pub channel_id: u64,
    pub deposit: u64,
    pub spending_limit: u64,
    pub settled: u64,
    pub last_nonce: u64,
    pub expires_at: i64,
    pub bump: u8,
}

#[error_code]
pub enum MeterboxError {
    #[msg("Deposit must be greater than zero")]
    InvalidDeposit,
    #[msg("Spending limit exceeds the channel deposit")]
    ExceedsDeposit,
    #[msg("Cumulative amount exceeds the spending limit")]
    ExceedsLimit,
    #[msg("Nonce must increase")]
    NonceTooLow,
    #[msg("Cumulative amount must increase")]
    AmountNotIncreasing,
    #[msg("Checked arithmetic overflow")]
    MathOverflow,
    #[msg("Channel expiry must be in the future")]
    InvalidExpiry,
    #[msg("Missing or invalid Ed25519 instruction")]
    MissingEd25519Instruction,
    #[msg("Malformed Ed25519 instruction")]
    MalformedEd25519Instruction,
    #[msg("Ed25519 public key or message must be in this instruction")]
    Ed25519ExternalData,
    #[msg("Voucher public key does not match the channel agent")]
    VoucherAgentMismatch,
    #[msg("Voucher message does not match this settlement")]
    VoucherMismatch,
    #[msg("Settlement would exceed the rent-exempt minimum")]
    RentMinimumExceeded,
    #[msg("Channel cannot be closed by this signer")]
    ChannelNotClosable,
    #[msg("Payer account is missing")]
    MissingPayer,
    #[msg("Unauthorized close")]
    UnauthorizedClose,
}

#[event]
pub struct ChannelOpened {
    pub channel: Pubkey,
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub agent: Pubkey,
    pub deposit: u64,
    pub spending_limit: u64,
    pub expires_at: i64,
}

#[event]
pub struct Settled {
    pub channel: Pubkey,
    pub delta: u64,
    pub cumulative: u64,
    pub nonce: u64,
}

#[event]
pub struct ChannelClosed {
    pub channel: Pubkey,
    pub payer: Pubkey,
    pub payee: Pubkey,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voucher_golden_vector_layout() {
        let mut expected = Vec::new();
        expected.extend_from_slice(b"METERBOX_VOUCHER_V1");
        expected.extend_from_slice(&crate::ID.to_bytes());
        expected.extend_from_slice(&Pubkey::default().to_bytes());
        expected.extend_from_slice(&Pubkey::new_from_array([1u8; 32]).to_bytes());
        expected.extend_from_slice(&1000u64.to_le_bytes());
        expected.extend_from_slice(&2u64.to_le_bytes());
        assert_eq!(expected.len(), 115);
    }
}
