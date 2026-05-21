CREATE UNIQUE INDEX IF NOT EXISTS "trade_request_one_pending_per_shift"
ON "TradeRequest"("shiftId")
WHERE "status" = 'PendingApproval';
