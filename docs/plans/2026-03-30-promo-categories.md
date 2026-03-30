# Promo Categories Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow promotions to apply discounts to all products in a category (e.g. all draught) alongside existing individual product discounts.

**Architecture:** New `promotion_categories` DB table mirrors `promotion_items` but uses `category` instead of `product_id`. `getPromoPrice` checks both tables. `PromoFormModal` gains a second section for category rows. `promotions.js` gains `replacePromotionCategories` and updated selects.

**Tech Stack:** React + Vite, Vitest, Tailwind CSS, Supabase

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260330_promotion_categories.sql`

#### Step 1: Create the migration file

```sql
-- supabase/migrations/20260330_promotion_categories.sql
create table promotion_categories (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id) on delete cascade,
  category text not null check (category in ('draught','bottle','spirit','soft','food','other')),
  discount_type text not null check (discount_type in ('percentage','fixed_price')),
  discount_value numeric(10,2) not null
);
```

#### Step 2: Commit and push (GitHub Actions will apply it automatically)

```bash
git add supabase/migrations/20260330_promotion_categories.sql
git commit -m "feat: add promotion_categories migration"
git push
```

#### Step 3: Verify in GitHub Actions

Go to GitHub → Actions tab → confirm the migrate workflow ran successfully.

---

### Task 2: Update `getPromoPrice` to check categories

**Files:**
- Modify: `src/lib/promos.js`
- Modify: `src/lib/promos.test.js`

The product object has a `category` field (e.g. `'draught'`). `getPromoPrice` needs to also loop over `promo.promotion_categories` and apply the discount if the product's category matches.

#### Step 1: Write failing tests

Add these tests to `src/lib/promos.test.js`.

First update the `makeProduct` helper to include a category field (the existing `PROD` constant needs `category`):

```js
function makeProduct(id, standard_price = 5.00, member_price = 4.00, category = 'draught') {
  return { id, name: 'Test Product', standard_price, member_price, category }
}
```

Update the promo factory helpers to include `promotion_categories`:

```js
function makeTimePromo({ id = 'promo-1', name = 'Happy Hour', active = true,
  start_time = '17:00', end_time = '19:00',
  days_of_week = null, items = [], categories = [] } = {}) {
  return { id, name, active, start_time, end_time, days_of_week,
    start_date: null, end_date: null, promotion_items: items, promotion_categories: categories }
}

function makeDatePromo({ id = 'promo-2', name = 'Event Night', active = true,
  start_date = '2026-04-01', end_date = '2026-04-01', items = [], categories = [] } = {}) {
  return { id, name, active, start_time: null, end_time: null,
    days_of_week: null, start_date, end_date, promotion_items: items, promotion_categories: categories }
}

function makeCatItem(category, discount_type = 'percentage', discount_value = 20) {
  return { id: 'cat-1', promotion_id: 'promo-1', category, discount_type, discount_value }
}
```

Add a new describe block at the bottom of `src/lib/promos.test.js`:

```js
describe('getPromoPrice — category discounts', () => {
  // PROD has category 'draught', standard_price 5.00

  it('applies category discount when product category matches', () => {
    const promo = makeTimePromo({
      categories: [makeCatItem('draught', 'percentage', 20)],
    })
    const now = makeDate(1, '18:00') // within window
    expect(getPromoPrice(PROD, [promo], now)).toBe(4.00)
  })

  it('returns null when product category does not match', () => {
    const promo = makeTimePromo({
      categories: [makeCatItem('food', 'percentage', 20)],
    })
    const now = makeDate(1, '18:00')
    expect(getPromoPrice(PROD, [promo], now)).toBeNull()
  })

  it('applies fixed_price category discount', () => {
    const promo = makeTimePromo({
      categories: [makeCatItem('draught', 'fixed_price', 3.50)],
    })
    const now = makeDate(1, '18:00')
    expect(getPromoPrice(PROD, [promo], now)).toBe(3.50)
  })

  it('ignores category discount when price >= standard_price', () => {
    const promo = makeTimePromo({
      categories: [makeCatItem('draught', 'fixed_price', 6.00)],
    })
    const now = makeDate(1, '18:00')
    expect(getPromoPrice(PROD, [promo], now)).toBeNull()
  })

  it('picks lowest price when both item and category discounts apply', () => {
    // item: 10% off = 4.50, category: 20% off = 4.00 → should pick 4.00
    const promo = makeTimePromo({
      items: [makeItem('prod-1', 'percentage', 10)],
      categories: [makeCatItem('draught', 'percentage', 20)],
    })
    const now = makeDate(1, '18:00')
    expect(getPromoPrice(PROD, [promo], now)).toBe(4.00)
  })

  it('picks item discount when it is lower than category discount', () => {
    // item: 30% off = 3.50, category: 10% off = 4.50 → should pick 3.50
    const promo = makeTimePromo({
      items: [makeItem('prod-1', 'percentage', 30)],
      categories: [makeCatItem('draught', 'percentage', 10)],
    })
    const now = makeDate(1, '18:00')
    expect(getPromoPrice(PROD, [promo], now)).toBe(3.50)
  })

  it('does not apply category discount when promo is outside time window', () => {
    const promo = makeTimePromo({
      start_time: '17:00',
      end_time: '19:00',
      categories: [makeCatItem('draught', 'percentage', 20)],
    })
    const now = makeDate(1, '20:00') // outside window
    expect(getPromoPrice(PROD, [promo], now)).toBeNull()
  })
})
```

#### Step 2: Run tests — confirm new tests fail

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run src/lib/promos.test.js
```

Expected: 7 new failures about category discounts.

#### Step 3: Update `getPromoPrice` in `src/lib/promos.js`

Add category checking inside the promo loop, after the existing `promotion_items` loop:

```js
export function getPromoPrice(product, promos, now = new Date()) {
  let lowestPrice = null

  for (const promo of promos) {
    if (!isPromoActive(promo, now)) continue

    // Check individual product discounts
    const items = promo.promotion_items ?? []
    for (const item of items) {
      if (item.product_id !== product.id) continue
      const price = calcDiscountedPrice(product, item)
      if (price >= product.standard_price) continue
      if (lowestPrice === null || price < lowestPrice) lowestPrice = price
    }

    // Check category discounts
    const catItems = promo.promotion_categories ?? []
    for (const catItem of catItems) {
      if (catItem.category !== product.category) continue
      const price = calcDiscountedPrice(product, catItem)
      if (price >= product.standard_price) continue
      if (lowestPrice === null || price < lowestPrice) lowestPrice = price
    }
  }

  return lowestPrice
}
```

#### Step 4: Run tests — confirm all pass

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run src/lib/promos.test.js
```

Expected: all tests pass.

#### Step 5: Commit

```bash
git add src/lib/promos.js src/lib/promos.test.js
git commit -m "feat: add category discount support to getPromoPrice"
```

---

### Task 3: Update `promotions.js` data layer

**Files:**
- Modify: `src/lib/promotions.js`

#### Step 1: Update selects to include `promotion_categories(*)`

In `fetchAllPromotions`, `fetchActivePromotions`, and both branches of `upsertPromotion`, change:

```js
.select('*, promotion_items(*)')
```

to:

```js
.select('*, promotion_items(*), promotion_categories(*)')
```

Also update `upsertPromotion` to strip `promotion_categories` from the destructure (so it isn't accidentally sent to the DB):

```js
export async function upsertPromotion(promotion) {
  const { id, promotion_items, promotion_categories, ...fields } = promotion
  // rest unchanged
```

#### Step 2: Add `replacePromotionCategories`

Add this function at the bottom of `src/lib/promotions.js`, directly mirroring `replacePromotionItems`:

```js
export async function replacePromotionCategories(promotion_id, categories) {
  const { error: delError } = await supabase
    .from('promotion_categories')
    .delete()
    .eq('promotion_id', promotion_id)
  if (delError) throw delError

  if (categories.length === 0) return []

  const rows = categories.map(cat => ({ ...cat, promotion_id }))
  const { data, error } = await supabase
    .from('promotion_categories')
    .insert(rows)
    .select()
  if (error) throw error
  return data
}
```

#### Step 3: Run full test suite

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected: all existing tests pass (no new tests needed for the data layer — the pattern is identical to `replacePromotionItems` which is already tested by integration).

#### Step 4: Commit

```bash
git add src/lib/promotions.js
git commit -m "feat: add promotion_categories to data layer"
```

---

### Task 4: Update `PromoFormModal` with category section

**Files:**
- Modify: `src/components/promos/PromoFormModal.jsx`

#### Step 1: Add `categoryItems` state and handlers

At the top of the component, alongside the existing `items` state, add:

```js
const CATEGORIES = ['draught', 'bottle', 'spirit', 'soft', 'food', 'other']

// Inside the component:
const [categoryItems, setCategoryItems] = useState(
  promo?.promotion_categories?.map(c => ({
    category: c.category,
    discount_type: c.discount_type,
    discount_value: String(c.discount_value),
  })) ?? []
)
```

Add handlers:

```js
function addCategoryItem() {
  setCategoryItems(prev => [...prev, { category: 'draught', discount_type: 'percentage', discount_value: '10' }])
}

function removeCategoryItem(index) {
  setCategoryItems(prev => prev.filter((_, i) => i !== index))
}

function updateCategoryItem(index, field, value) {
  setCategoryItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
}
```

#### Step 2: Update `handleSubmit` to call `replacePromotionCategories`

Import `replacePromotionCategories` at the top:

```js
import { upsertPromotion, replacePromotionItems, replacePromotionCategories } from '../../lib/promotions'
```

In `handleSubmit`, after `replacePromotionItems`:

```js
const catRows = categoryItems.map(c => ({
  category: c.category,
  discount_type: c.discount_type,
  discount_value: Number(c.discount_value),
}))
await replacePromotionCategories(saved.id, catRows)
```

Full updated `handleSubmit`:

```js
async function handleSubmit(e) {
  e.preventDefault()
  setSaving(true)
  setError(null)
  try {
    const payload = {
      ...(isEditing ? { id: promo.id } : {}),
      name: name.trim(),
      active: promo?.active ?? true,
      start_time: scheduleType === 'time' ? startTime : null,
      end_time: scheduleType === 'time' ? endTime : null,
      days_of_week: scheduleType === 'time' ? (daysOfWeek.length > 0 ? daysOfWeek : null) : null,
      start_date: scheduleType === 'date' ? (startDate || null) : null,
      end_date: scheduleType === 'date' ? (endDate || null) : null,
    }

    const saved = await upsertPromotion(payload)

    const itemRows = items
      .filter(i => i.product_id)
      .map(i => ({
        product_id: i.product_id,
        discount_type: i.discount_type,
        discount_value: Number(i.discount_value),
      }))
    await replacePromotionItems(saved.id, itemRows)

    const catRows = categoryItems.map(c => ({
      category: c.category,
      discount_type: c.discount_type,
      discount_value: Number(c.discount_value),
    }))
    await replacePromotionCategories(saved.id, catRows)

    onSaved()
  } catch (err) {
    setError(err.message ?? 'An error occurred. Please try again.')
    setSaving(false)
  }
}
```

#### Step 3: Add the category section to the JSX

Add this section immediately after the closing `</div>` of the "Products & discounts" section (around line 333 in the current file):

```jsx
{/* Category discounts */}
<div className="flex flex-col gap-2">
  <div className="flex items-center justify-between">
    <span className={labelCls}>Categories &amp; discounts</span>
    <button
      type="button"
      onClick={addCategoryItem}
      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
    >
      <Plus size={12} aria-hidden="true" />
      Add category
    </button>
  </div>

  {categoryItems.length === 0 && (
    <p className="text-slate-500 text-xs italic">No categories added yet.</p>
  )}

  {categoryItems.map((item, index) => (
    <div key={index} className="flex gap-2 items-end">
      <div className="flex-1 flex flex-col gap-1">
        <label className="text-xs text-slate-400">Category</label>
        <select
          value={item.category}
          onChange={e => updateCategoryItem(index, 'category', e.target.value)}
          className="bg-[#1E293B] border border-slate-600 rounded-lg px-2 py-2 text-white text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] cursor-pointer"
          aria-label={`Category ${index + 1}`}
        >
          {CATEGORIES.map(cat => (
            <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">Type</label>
        <select
          value={item.discount_type}
          onChange={e => updateCategoryItem(index, 'discount_type', e.target.value)}
          className="bg-[#1E293B] border border-slate-600 rounded-lg px-2 py-2 text-white text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] cursor-pointer"
          aria-label={`Category discount type ${index + 1}`}
        >
          <option value="percentage">%</option>
          <option value="fixed_price">£</option>
        </select>
      </div>
      <div className="w-20 flex flex-col gap-1">
        <label className="text-xs text-slate-400">Value</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={item.discount_value}
          onChange={e => updateCategoryItem(index, 'discount_value', e.target.value)}
          required
          placeholder="10"
          className="bg-[#1E293B] border border-slate-600 rounded-lg px-2 py-2 text-white text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          aria-label={`Category discount value ${index + 1}`}
        />
      </div>
      <button
        type="button"
        onClick={() => removeCategoryItem(index)}
        aria-label="Remove category line"
        className="text-slate-500 hover:text-red-400 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  ))}
</div>
```

#### Step 4: Run full test suite

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected: all tests pass.

#### Step 5: Build to confirm no compile errors

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

#### Step 6: Commit and push

```bash
git add src/components/promos/PromoFormModal.jsx
git commit -m "feat: add category discounts section to PromoFormModal"
git push
```
