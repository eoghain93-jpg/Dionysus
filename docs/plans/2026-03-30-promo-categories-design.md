# Promo Categories — Design

## Goal

Allow promotions to apply discounts to all products in a category (e.g. all draught) alongside existing individual product discounts.

## Database

New `promotion_categories` table:

```sql
create table promotion_categories (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id) on delete cascade,
  category text not null check (category in ('draught','bottle','spirit','soft','food','other')),
  discount_type text not null check (discount_type in ('percentage','fixed_price')),
  discount_value numeric(10,2) not null
);
```

Migration file added to `supabase/migrations/` and auto-applied via GitHub Actions.

## Data Layer

Changes to `src/lib/promotions.js`:
- Add `replacePromotionCategories(promotion_id, rows)` — deletes existing rows for the promotion then inserts new ones
- Update `fetchAllPromotions` and `fetchActivePromotions` to select `promotion_categories(*)` alongside `promotion_items(*)`

## Pricing Logic

`getPromoPrice` in `src/lib/promos.js` updated to check both:
- `promotion_items` — exact product match (existing)
- `promotion_categories` — product's category matches a category row on the promo (new)

Returns the lowest applicable price across both sources.

## PromoFormModal

Second section added below "Products & discounts": **Categories & discounts**. Same row structure — category dropdown + discount type (% or £) + value + remove button. "Add category" button appends a new row. On save, `replacePromotionCategories` is called alongside `replacePromotionItems`.

## Testing

- `src/lib/promos.test.js` — new tests for category-based discount logic in `getPromoPrice`
- `src/lib/promotions.test.js` (if exists) — tests for `replacePromotionCategories`
- `src/components/promos/PromoFormModal.test.jsx` (if exists) — tests for category rows UI
