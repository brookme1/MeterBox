//! MeterBox channel: deposit SOL, accept cumulative Ed25519 vouchers, settle once.
use anchor_lang::prelude::*;

declare_id!("MeterBox1111111111111111111111111111111111");

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
    ) -> Result<()> {
        require!(deposit > 0, MeterboxError::InvalidDeposit);
        require!(spending_limit <= deposit, MeterboxError::ExceedsDeposit);
        let channel = &mut ctx.accounts.channel;
        channel.payer = ctx.accounts.payer.key();
        channel.payee = ctx.accounts.payee.key();
        channel.agent = agent;
        channel.channel_id = channel_id;
        channel.deposit = deposit;
        channel.spending_limit = spending_limit;
        channel.settled = 0;
        channel.last_nonce = 0;
        channel.bump = ctx.bumps.channel;
        let cpi = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: channel.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi, deposit)?;
        Ok(())
    }

    /// Pay `cumulative - settled` to the payee after the caller has checked the voucher.
    /// Full Ed25519 instruction parsing belongs in front of this instruction; see README.
    pub fn settle(ctx: Context<Settle>, cumulative_amount: u64, nonce: u64) -> Result<()> {
        let channel = &mut ctx.accounts.channel;
        require!(nonce > channel.last_nonce, MeterboxError::NonceTooLow);
        require!(cumulative_amount > channel.settled, MeterboxError::AmountNotIncreasing);
        require!(cumulative_amount <= channel.spending_limit, MeterboxError::ExceedsLimit);
        require!(cumulative_amount <= channel.deposit, MeterboxError::ExceedsDeposit);
        let delta = cumulative_amount
            .checked_sub(channel.settled)
            .ok_or(MeterboxError::MathOverflow)?;
        **channel.to_account_info().try_borrow_mut_lamports()? = channel
            .to_account_info()
            .lamports()
            .checked_sub(delta)
            .ok_or(MeterboxError::MathOverflow)?;
        **ctx.accounts.payee.to_account_info().try_borrow_mut_lamports()? = ctx
            .accounts
            .payee
            .to_account_info()
            .lamports()
            .checked_add(delta)
            .ok_or(MeterboxError::MathOverflow)?;
        channel.settled = cumulative_amount;
        channel.last_nonce = nonce;
        Ok(())
    }
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
        space = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1,
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
    pub bump: u8,
}

#[error_code]
pub enum MeterboxError {
    InvalidDeposit,
    ExceedsDeposit,
    ExceedsLimit,
    NonceTooLow,
    AmountNotIncreasing,
    MathOverflow,
}
