'use client';
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Empty, Notice, Panel, SearchInput, Segmented, SelectField, Sheet, Switch, TextArea, TextField, useToast } from '@/components/ui/ui';
import { Topbar } from './shell';
import { archiveService, deleteCategory, saveCategory, saveService, updateServicePrice } from '@/actions/catalog';
import { money } from '@/lib/billing';
import type { Service, ServiceCategory } from '@/lib/types';

export interface ServicesProps {
  services: Service[];      // including archived
  categories: ServiceCategory[];
  defaultGstRate: number;
  pricesIncludeTax: boolean;
}

const GST_RATES = [0, 5, 12, 18, 28];
const GENDER_LABEL: Record<Service['gender'], string> = { unisex: 'Everyone', female: 'Women', male: 'Men' };
const UNCATEGORISED = '__none';

function duration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function ServicesScreen({ services, categories, defaultGstRate, pricesIncludeTax }: ServicesProps) {
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [newInCategory, setNewInCategory] = useState<string | null>(null);
  const [catEdit, setCatEdit] = useState<ServiceCategory | 'new' | null>(null);
  const [catDelete, setCatDelete] = useState<ServiceCategory | null>(null);

  const activeCount = services.filter((s) => s.active).length;
  const archivedCount = services.length - activeCount;

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const visible = services
      .filter((s) => (showArchived || s.active) && (!term || s.name.toLowerCase().includes(term)))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.sort - b.sort || a.name.localeCompare(b.name));
    const known = new Set(categories.map((c) => c.id));
    const out = [...categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .map((c) => ({ category: c as ServiceCategory | null, items: visible.filter((s) => s.category_id === c.id) }));
    const loose = visible.filter((s) => !s.category_id || !known.has(s.category_id));
    if (loose.length) out.push({ category: null, items: loose });
    // While searching, hide empty groups; otherwise show empty categories so they can be filled.
    return term ? out.filter((g) => g.items.length) : out;
  }, [services, categories, q, showArchived]);

  const openNew = (categoryId: string | null) => { setNewInCategory(categoryId); setEditing('new'); };

  return (
    <>
      <Topbar title="Services" subtitle={`${activeCount} on the menu · ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`}
        actions={<>
          <Button icon="plus" className="hide-mobile" onClick={() => setCatEdit('new')}>New category</Button>
          <Button variant="primary" icon="plus" onClick={() => openNew(null)}>Add service</Button>
        </>} />
      <div className="page page-narrow">
        <div className="row-wrap">
          <div className="grow" style={{ minWidth: 220, maxWidth: 360 }}><SearchInput value={q} onChange={setQ} placeholder="Find a service" /></div>
          {archivedCount > 0 && <Switch checked={showArchived} onChange={setShowArchived} label={<span className="small ink2">Show archived ({archivedCount})</span>} />}
          <span className="small muted" style={{ marginLeft: 'auto' }}>
            Prices {pricesIncludeTax ? 'include' : 'exclude'} GST · default {defaultGstRate}%
          </span>
        </div>

        {services.length === 0 && categories.length === 0 ? (
          <div className="panel">
            <Empty icon="scissors" title="Build your service menu" action={<Button variant="primary" icon="plus" onClick={() => openNew(null)}>Add your first service</Button>}>
              Add each service with its price and how long it takes. The calendar, bills and WhatsApp assistant all use this menu.
            </Empty>
          </div>
        ) : groups.length === 0 ? (
          <div className="panel"><Empty icon="search" title="No services match">Try another name, or clear the search.</Empty></div>
        ) : groups.map((g) => (
          <Fragment key={g.category?.id ?? UNCATEGORISED}>
          <Panel flush
            title={<div className="row" style={{ minWidth: 0 }}><h2 className="truncate">{g.category?.name ?? 'Uncategorised'}</h2><span className="badge">{g.items.filter((s) => s.active).length}</span></div>}
            actions={<>
              {g.category && <Button size="sm" variant="ghost" icon="edit" aria-label={`Rename ${g.category.name}`} title="Rename" onClick={() => setCatEdit(g.category)} />}
              {g.category && <Button size="sm" variant="ghost" icon="trash" aria-label={`Delete ${g.category.name}`} title="Delete category" onClick={() => setCatDelete(g.category)} />}
              <Button size="sm" icon="plus" onClick={() => openNew(g.category?.id ?? null)}>Add</Button>
            </>}>
            {g.items.length ? (
              <ul className="list">
                {g.items.map((s) => <Fragment key={s.id}><ServiceRow service={s} defaultGstRate={defaultGstRate} onOpen={() => setEditing(s)} /></Fragment>)}
              </ul>
            ) : (
              <p className="panel-body small muted">No services here yet. <button type="button" className="link-btn" onClick={() => openNew(g.category?.id ?? null)}>Add one</button></p>
            )}
          </Panel>
          </Fragment>
        ))}
        {categories.length + services.length > 0 && !q && (
          <button type="button" className="add-tile" onClick={() => setCatEdit('new')}>
            <span aria-hidden>+</span> New category
          </button>
        )}
      </div>

      <ServiceSheet service={editing} defaultCategory={newInCategory} categories={categories} defaultGstRate={defaultGstRate}
        pricesIncludeTax={pricesIncludeTax} onClose={() => setEditing(null)} />
      <CategoryDialog category={catEdit} onClose={() => setCatEdit(null)} />
      <DeleteCategoryDialog category={catDelete} count={catDelete ? services.filter((s) => s.category_id === catDelete.id).length : 0} onClose={() => setCatDelete(null)} />
    </>
  );
}

function ServiceRow({ service: s, defaultGstRate, onOpen }: { service: Service; defaultGstRate: number; onOpen: () => void }) {
  const meta = [duration(s.duration_min)];
  if (s.gender !== 'unisex') meta.push(GENDER_LABEL[s.gender]);
  if (s.gst_rate !== null && Number(s.gst_rate) !== Number(defaultGstRate)) meta.push(`GST ${Number(s.gst_rate)}%`);
  return (
    <li className={`svc-row${s.active ? '' : ' is-archived'}`}>
      <button type="button" className="svc-main" onClick={onOpen}>
        <span className="strong truncate">{s.name}</span>
        <span className="small muted truncate">{meta.join(' · ')}{s.description ? ` · ${s.description}` : ''}</span>
      </button>
      <div className="svc-badges">
        {!s.active && <Badge>Archived</Badge>}
        {s.active && !s.online_bookable && <Badge tone="outline">Online booking off</Badge>}
      </div>
      <PriceCell service={s} />
      <Button size="sm" variant="ghost" icon="chevronRight" aria-label={`Edit ${s.name}`} onClick={onOpen} className="hide-mobile" />
    </li>
  );
}

/** Tap the price to change it in place. Enter saves, Escape cancels. */
function PriceCell({ service }: { service: Service }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(service.price));
  const [shown, setShown] = useState(Number(service.price));
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => { setShown(Number(service.price)); }, [service.price]);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);

  const save = () => {
    const n = Number(value.replace(/[,\s₹]/g, ''));
    setEditing(false);
    if (!value.trim() || !Number.isFinite(n) || n === shown) return;
    const before = shown;
    setShown(n);
    start(async () => {
      const r = await updateServicePrice(service.id, n);
      if (!r.ok) { setShown(before); toast(r.error, 'error'); return; }
      toast(`${service.name}: ${money(n)}`);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <div className="prefix-input svc-price-input">
        <span>₹</span>
        <input ref={input} className="input input-sm num" inputMode="decimal" value={value} aria-label={`Price of ${service.name}`}
          onChange={(e) => setValue(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(String(shown)); setEditing(false); } }} />
      </div>
    );
  }
  return (
    <button type="button" className="svc-price num" disabled={!service.active || pending} title={service.active ? 'Change price' : undefined}
      aria-label={`${money(shown)} — change price of ${service.name}`} onClick={() => { setValue(String(shown)); setEditing(true); }}>
      {money(shown)}
    </button>
  );
}

function ServiceSheet({ service, defaultCategory, categories, defaultGstRate, pricesIncludeTax, onClose }: {
  service: Service | 'new' | null; defaultCategory: string | null; categories: ServiceCategory[]; defaultGstRate: number; pricesIncludeTax: boolean; onClose: () => void;
}) {
  const existing = service && service !== 'new' ? service : null;
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [durationMin, setDurationMin] = useState('30');
  const [price, setPrice] = useState('');
  const [gst, setGst] = useState('default');
  const [gender, setGender] = useState<Service['gender']>('unisex');
  const [description, setDescription] = useState('');
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [archiving, startArchive] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!service) return;
    const s = service === 'new' ? null : service;
    setName(s?.name ?? '');
    setCategoryId(s ? s.category_id ?? '' : defaultCategory ?? categories[0]?.id ?? '');
    setDurationMin(String(s?.duration_min ?? 30));
    setPrice(s ? String(s.price) : '');
    setGst(s?.gst_rate === null || s?.gst_rate === undefined ? 'default' : String(Number(s.gst_rate)));
    setGender(s?.gender ?? 'unisex');
    setDescription(s?.description ?? '');
    setOnline(s?.online_bookable ?? true);
    setError(null);
  }, [service, defaultCategory, categories]);

  const submit = () => start(async () => {
    setError(null);
    const r = await saveService({
      id: existing?.id, name, categoryId: categoryId || null, durationMin: Number(durationMin), price: Number(price.replace(/[,\s₹]/g, '')),
      gstRate: gst === 'default' ? null : Number(gst), gender, description, onlineBookable: online, active: existing?.active ?? true,
    });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved');
    router.refresh();
    onClose();
  });

  const toggleArchive = () => startArchive(async () => {
    if (!existing) return;
    const r = await archiveService(existing.id, existing.active);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved');
    router.refresh();
    onClose();
  });

  const durations = [10, 15, 20, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360];
  const durationOptions = durations.includes(Number(durationMin)) ? durations : [...durations, Number(durationMin)].sort((a, b) => a - b);

  return (
    <Sheet open={!!service} onClose={onClose} title={existing ? 'Edit service' : 'New service'} width={500}
      footer={<>
        {existing && (
          <Button variant={existing.active ? 'danger' : 'secondary'} loading={archiving} onClick={toggleArchive} style={{ marginRight: 'auto' }}>
            {existing.active ? 'Archive' : 'Restore to menu'}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={submit}>{existing ? 'Save service' : 'Add service'}</Button>
      </>}>
      <div className="stack-lg">
        {existing && !existing.active && <Notice tone="warn">This service is archived. It isn’t offered for booking or billing; past bills still show it.</Notice>}
        <TextField label="Service name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Haircut & style" autoFocus={!existing} maxLength={80} />
        <SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Uncategorised</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="svc-price">Price</label>
            <div className="prefix-input"><span>₹</span>
              <input id="svc-price" className="input num" inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <span className="hint">{pricesIncludeTax ? 'Including GST' : 'GST is added on the bill'}</span>
          </div>
          <SelectField label="Duration" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} hint="Blocks this much time on the calendar">
            {durationOptions.map((d) => <option key={d} value={d}>{duration(d)}</option>)}
          </SelectField>
        </div>
        <div className="grid-2">
          <SelectField label="GST rate" value={gst} onChange={(e) => setGst(e.target.value)}>
            <option value="default">Salon default ({defaultGstRate}%)</option>
            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
          </SelectField>
          <div className="field">
            <span className="label">For</span>
            <Segmented label="Who this service is for" value={gender} onChange={setGender}
              options={(['unisex', 'female', 'male'] as const).map((g) => ({ value: g, label: GENDER_LABEL[g] }))} />
          </div>
        </div>
        <TextArea label="Description" hint="Optional. Shown on your booking page and used by the WhatsApp assistant." rows={3} maxLength={500}
          value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What’s included, aftercare, who it suits" />
        <div className="setting-row">
          <div className="grow">
            <div className="strong">Clients can book this online</div>
            <div className="small muted">On your booking page and through the WhatsApp assistant. Turn off for services that need a consultation first.</div>
          </div>
          <Switch checked={online} onChange={setOnline} label={<span className="sr-only">Online booking</span>} />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Sheet>
  );
}

function CategoryDialog({ category, onClose }: { category: ServiceCategory | 'new' | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const existing = category && category !== 'new' ? category : null;

  useEffect(() => { if (category) { setName(existing?.name ?? ''); setError(null); } }, [category, existing]);

  const submit = () => start(async () => {
    const r = await saveCategory({ id: existing?.id, name });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved');
    router.refresh();
    onClose();
  });

  return (
    <Dialog open={!!category} onClose={onClose} title={existing ? 'Rename category' : 'New category'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={pending} onClick={submit}>{existing ? 'Save' : 'Add category'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <TextField label="Category name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hair, Skin, Bridal" autoFocus maxLength={40} error={error} />
      </form>
    </Dialog>
  );
}

function DeleteCategoryDialog({ category, count, onClose }: { category: ServiceCategory | null; count: number; onClose: () => void }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Dialog open={!!category} onClose={onClose} title={`Delete “${category?.name ?? ''}”?`}
      footer={<><Button variant="ghost" onClick={onClose}>Keep it</Button>
        <Button variant="danger" icon="trash" loading={pending} onClick={() => start(async () => {
          if (!category) return;
          const r = await deleteCategory(category.id);
          if (!r.ok) return toast(r.error, 'error');
          toast(r.message ?? 'Category deleted');
          router.refresh();
          onClose();
        })}>Delete category</Button></>}>
      <p className="ink2">
        {count
          ? <>The {count} service{count === 1 ? '' : 's'} in it will stay on your menu under <strong>Uncategorised</strong>. Nothing is removed from past bills.</>
          : 'This category is empty.'}
      </p>
    </Dialog>
  );
}
