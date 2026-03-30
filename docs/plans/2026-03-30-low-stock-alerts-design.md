# Low Stock Alerts — Design

## Goal

Products can have an optional reorder threshold. When stock drops below the threshold, an email is sent to the manager and the Stock page shows a badge with the count of low-stock items.

## Database

Add `reorder_threshold` column to `products` table (nullable — opt-in per product):

```sql
alter table products add column if not exists reorder_threshold integer;
```

## Architecture

**Stock page badge**
- Nav item for Stock shows a red badge with the count of products where `stock_on_hand <= reorder_threshold` and `reorder_threshold is not null`
- Clicking the badge filters the stock list to low-stock items only (toggle filter)
- Low-stock product rows highlighted with a subtle amber indicator

**Email alert trigger**
- After every stock movement (sale, wastage, spillage), check if the product has crossed below its threshold
- If yes, call `notify-low-stock` edge function
- Edge function sends an email via Supabase's SMTP (or Resend) to `MANAGER_EMAIL` env var
- Email includes: product name, current stock level, threshold, timestamp
- Debounce: only send once per product per hour (store last-notified timestamp to avoid spam on busy periods)

**New edge function: `notify-low-stock`**
- Accepts `{ product_id, product_name, stock_on_hand, reorder_threshold }`
- Checks last notification time (stored in a `low_stock_notifications` table or product column)
- Sends email if not notified in the last hour
- Returns `{ sent: boolean }`

**Threshold management**
- Set reorder threshold on the product edit form in the Stock page (optional numeric field)
