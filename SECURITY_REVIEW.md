# Kinn Smart Contract Security Review — Phase 5

## Fixed findings

1. **Unbounded inheritance execution (high):** processing every deposited token and every beneficiary in one trigger transaction could exceed the block gas limit and permanently block inheritance. The trigger now performs only the state transition. Each token is processed in a separate permissionless transaction, and beneficiary count is capped at 50.
2. **Transfer-then-false double payment (high):** a non-standard token could mutate balances and return `false`, leaving a pending entitlement after the beneficiary had already received tokens. Distribution transfers now run inside an isolated contract self-call. A false return or revert rolls back token-side state before the transfer is recorded as pending.
3. **Gas exhaustion by malicious token (high):** token transfer execution is capped at 200,000 gas. A token that exhausts or reverts consumes only the isolated attempt and leaves the entitlement pending.
4. **False-success token behavior (medium):** successful distribution now verifies that Kinn's token balance decreased by exactly the requested amount. Tokens that return success without moving the expected balance are treated as failed.
5. **Post-trigger owner mutation (high):** settings, beneficiaries, deposits, withdrawals, check-ins, and vault closure are rejected after inheritance triggers.
6. **Double processing/payment (high):** each vault token can be snapshotted once, successful entitlements are cleared, and only stored unpaid amounts can be retried.
7. **Rounding dust (medium):** the final beneficiary receives the exact remainder after earlier basis-point calculations.
8. **Automation reserve payment (high):** native ETH reserve is isolated from ERC-20 balances, reimburses only valid maintenance calls, caps each reimbursement at a deployment-configured fee, and does not block inheritance when empty. A rejected ETH payment restores the reserve and does not revert the underlying maintenance action. Once all token work and retries are complete, unused reserve can be claimed by the maintenance caller rather than remaining permanently stranded.

## Accepted constraints and residual risks

- Kinn targets conventional ERC-20-compatible tokens. Rebasing, fee-on-transfer, reflection, and administratively destructive tokens are unsupported in the base version.
- Direct token transfers to the contract bypass vault accounting and are not credited. Users must use `deposit`.
- Issuer freezes, pauses, blacklists, or legal restrictions can prevent delivery. Such amounts remain pending for future retry; Kinn cannot bypass issuer controls.
- Timestamps are appropriate for multi-week deadlines, although block producers can make small timestamp adjustments. This cannot materially skip a configured multi-week period.
- Distribution is intentionally batched per token. A relayer/keeper must call `distributeInheritanceToken` for every tracked token after triggering inheritance.
- Automation reimbursement is deployment-configured (`automationFeeWei`) because gas costs differ by network. The configured fee should be reviewed against the selected BOT Chain/X Layer environments before deployment.
- The 50-beneficiary limit bounds distribution gas. Deployment testing should confirm the desired production limit against Base block gas conditions.
