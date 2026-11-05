import type { Client, ClientOrderTemplate, CoreMaterial, CoreSpecification, InventoryItem, OrderProductKind, RawMaterial } from '@/lib/types';
import type { ProductLine } from '@/components/admin/orders/order-products-editor';
import { newStretchLine, type StretchLine } from '@/lib/stretch-lines';

/**
 * Pedido habitual por cliente (tabla client_order_templates):
 *  - conversión a líneas del formulario de pedido (stretch + productos de bodega)
 *  - payload para la RPC replace_client_templates
 *  - exportar / importar CSV masivo (Excel, separador ";")
 */
let pseq = 500000;

export function templatesToLines(rows: ClientOrderTemplate[]) {
    const sorted = [...rows].sort((a, b) => a.position - b.position);
    const stretch: StretchLine[] = [];
    const products: ProductLine[] = [];
    for (const t of sorted) {
        if (t.kind === 'stretch') {
            stretch.push(
                newStretchLine({
                    raw_material_id: t.raw_material_id || '',
                    core_id: t.core_id || '',
                    quantity: String(Number(t.quantity)),
                    weight_grams: String(Number(t.weight_grams || 0)),
                    unit_price: String(Number(t.unit_price)),
                })
            );
        } else {
            const ref =
                t.kind === 'insumo'
                    ? t.inventory_item_id
                    : t.kind === 'bobina'
                      ? t.raw_material_id
                      : t.kind === 'core'
                        ? t.core_id
                        : t.core_material_id;
            products.push({
                key: pseq++,
                kind: t.kind as OrderProductKind,
                ref_id: ref || '',
                quantity: String(Number(t.quantity)),
                unit_price: String(Number(t.unit_price)),
            });
        }
    }
    return { stretch, products };
}

export function linesToTemplatePayload(stretch: StretchLine[], products: ProductLine[]) {
    return [
        ...stretch.map((l) => ({
            kind: 'stretch',
            raw_material_id: l.raw_material_id,
            core_id: l.core_id,
            weight_grams: Number(l.weight_grams) || null,
            quantity: Number(l.quantity) || 0,
            unit_price: Number(l.unit_price) || 0,
        })),
        ...products.map((p) => ({
            kind: p.kind,
            raw_material_id: p.kind === 'bobina' ? p.ref_id : null,
            core_id: p.kind === 'core' ? p.ref_id : null,
            inventory_item_id: p.kind === 'insumo' ? p.ref_id : null,
            core_material_id: p.kind === 'material_core' ? p.ref_id : null,
            quantity: Number(p.quantity) || 0,
            unit_price: Number(p.unit_price) || 0,
        })),
    ];
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export const TEMPLATE_CSV_HEADERS = [
    'cliente_nit',
    'cliente',
    'frecuencia_dias',
    'tipo',
    'referencia',
    'medida_cm',
    'material_core',
    'peso_g',
    'cantidad',
    'precio',
];

export const TEMPLATE_CSV_HELP = [
    'tipo: stretch | insumo | bobina | core | material_core',
    'stretch: referencia = nombre de la bobina madre; medida_cm = medida del rollo (core); material_core = material del core (opcional si solo hay uno de esa medida); peso_g = peso total por rollo',
    'insumo: referencia = código (SKU) o nombre del producto de Otros inventarios',
    'bobina: referencia = nombre de la bobina madre (venta en kg)',
    'core: medida_cm + material_core (venta de cores armados)',
    'material_core: referencia = nombre del material de cores (venta en kg)',
    'Un cliente sin líneas pero con frecuencia: deja tipo vacío. Al importar se REEMPLAZA el pedido habitual de los clientes que aparezcan en el archivo.',
];

type Catalog = {
    raws: RawMaterial[];
    cores: CoreSpecification[];
    coreMaterials: CoreMaterial[];
    items: InventoryItem[];
};

const num = (n: number | null | undefined) => (n == null ? '' : String(Number(n)).replace('.', ','));

export function buildTemplateRows(clients: Client[], templates: ClientOrderTemplate[], cat: Catalog): (string | number)[][] {
    const rows: (string | number)[][] = [];
    const matName = (c?: CoreSpecification | null) => cat.coreMaterials.find((m) => m.id === c?.core_material_id)?.name || '';
    for (const cl of [...clients].sort((a, b) => a.business_name.localeCompare(b.business_name))) {
        const lines = templates.filter((t) => t.client_id === cl.id).sort((a, b) => a.position - b.position);
        const head = [cl.nit_rut || '', cl.business_name, cl.reorder_days ?? ''];
        if (lines.length === 0) {
            if (cl.reorder_days) rows.push([...head, '', '', '', '', '', '', '']);
            continue;
        }
        for (const t of lines) {
            const raw = cat.raws.find((r) => r.id === t.raw_material_id);
            const core = cat.cores.find((c) => c.id === t.core_id);
            const item = cat.items.find((i) => i.id === t.inventory_item_id);
            const mat = cat.coreMaterials.find((m) => m.id === t.core_material_id);
            const ref =
                t.kind === 'stretch' || t.kind === 'bobina'
                    ? raw?.name || ''
                    : t.kind === 'insumo'
                      ? item?.sku || item?.name || ''
                      : t.kind === 'material_core'
                        ? mat?.name || ''
                        : core?.name || '';
            rows.push([
                ...head,
                t.kind,
                ref,
                t.kind === 'stretch' || t.kind === 'core' ? num(core?.length_cm) : '',
                t.kind === 'stretch' || t.kind === 'core' ? matName(core) : '',
                t.kind === 'stretch' ? num(t.weight_grams) : '',
                num(t.quantity),
                num(t.unit_price),
            ]);
        }
    }
    return rows;
}

/** Parser CSV tolerante: separador ";" o ",", comillas dobles, BOM */
export function parseCSV(text: string): string[][] {
    const clean = text.replace(/^\uFEFF/, '');
    const firstLine = clean.split(/\r?\n/)[0] || '';
    const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (inQuotes) {
            if (ch === '"' && clean[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (ch === '"') inQuotes = false;
            else cell += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === sep) {
            row.push(cell);
            cell = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && clean[i + 1] === '\n') i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else cell += ch;
    }
    if (cell !== '' || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (s: string) =>
    s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
const toNum = (s: string) => {
    const t = (s || '').trim().replace(/\s/g, '');
    if (!t) return NaN;
    // "1.500,5" -> 1500.5 ; "8,3" -> 8.3 ; "1.100" / "12.500" -> miles ; "8.3" -> 8.3
    if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
    return Number(t);
};

export type ImportIssue = { row: number; message: string };
export type ImportResult = {
    data: { client_id: string; client_name: string; reorder_days: number | null; lines: ReturnType<typeof linesToTemplatePayload> }[];
    errors: ImportIssue[];
    lineCount: number;
};

export function resolveTemplateImport(table: string[][], clients: Client[], cat: Catalog): ImportResult {
    const errors: ImportIssue[] = [];
    if (table.length === 0) return { data: [], errors: [{ row: 0, message: 'El archivo está vacío' }], lineCount: 0 };
    const header = table[0].map(norm);
    const col = (name: string) => header.indexOf(name);
    for (const h of ['tipo', 'cantidad']) {
        if (col(h) < 0) errors.push({ row: 1, message: `Falta la columna "${h}"` });
    }
    if (col('cliente_nit') < 0 && col('cliente') < 0) errors.push({ row: 1, message: 'Falta la columna "cliente" o "cliente_nit"' });
    if (errors.length) return { data: [], errors, lineCount: 0 };

    const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] || '').trim() : '');
    const byClient = new Map<string, ImportResult['data'][number]>();
    let lineCount = 0;

    table.slice(1).forEach((r, i) => {
        const rowNo = i + 2;
        // NIT: se compara sin puntos ni dígito de verificación (900.123.456-7 = 900123456)
        const nitBase = (v: string) => v.split('-')[0].replace(/[^0-9a-zA-Z]/g, '');
        const nit = nitBase(get(r, 'cliente_nit'));
        const name = get(r, 'cliente');
        const client =
            (nit && clients.find((c) => c.nit_rut && nitBase(c.nit_rut) === nit)) ||
            (name && clients.find((c) => norm(c.business_name) === norm(name))) ||
            null;
        if (!client) {
            errors.push({ row: rowNo, message: `Cliente no encontrado: ${name || nit || '(vacío)'}` });
            return;
        }
        let entry = byClient.get(client.id);
        if (!entry) {
            entry = { client_id: client.id, client_name: client.business_name, reorder_days: null, lines: [] };
            byClient.set(client.id, entry);
        }
        const freq = get(r, 'frecuencia_dias');
        if (freq) {
            const f = Math.floor(toNum(freq));
            if (!(f > 0)) errors.push({ row: rowNo, message: 'frecuencia_dias debe ser un número de días mayor a 0' });
            else entry.reorder_days = f;
        }

        const kind = norm(get(r, 'tipo'));
        if (!kind) return; // fila solo con frecuencia
        const ref = get(r, 'referencia');
        const qty = toNum(get(r, 'cantidad'));
        const price = get(r, 'precio') ? toNum(get(r, 'precio')) : 0;
        if (!(qty > 0)) return errors.push({ row: rowNo, message: 'cantidad debe ser mayor a 0' });
        if (!(price >= 0)) return errors.push({ row: rowNo, message: 'precio inválido' });

        const findRaw = () => cat.raws.find((x) => norm(x.name) === norm(ref));
        const findCore = () => {
            const len = toNum(get(r, 'medida_cm'));
            const mat = norm(get(r, 'material_core'));
            const list = cat.cores.filter((c) => Math.abs(Number(c.length_cm) - len) < 0.05);
            if (mat) return list.filter((c) => norm(cat.coreMaterials.find((m) => m.id === c.core_material_id)?.name || '') === mat);
            return list;
        };

        if (kind === 'stretch' || kind === 'core') {
            const raw = kind === 'stretch' ? findRaw() : undefined;
            if (kind === 'stretch' && !raw) return errors.push({ row: rowNo, message: `Bobina madre no encontrada: "${ref}"` });
            const cores = findCore();
            if (cores.length === 0)
                return errors.push({ row: rowNo, message: `No hay core de ${get(r, 'medida_cm') || '?'} cm ${get(r, 'material_core')}`.trim() });
            if (cores.length > 1)
                return errors.push({ row: rowNo, message: `Hay varios cores de ${get(r, 'medida_cm')} cm: indica material_core` });
            if (kind === 'stretch') {
                const w = toNum(get(r, 'peso_g'));
                if (!(w > 0)) return errors.push({ row: rowNo, message: 'peso_g es obligatorio en líneas stretch' });
                if (w <= Number(cores[0].weight_grams || 0))
                    return errors.push({ row: rowNo, message: `peso_g (${w}) debe ser mayor al peso del core (${cores[0].weight_grams} g)` });
                entry.lines.push({ kind: 'stretch', raw_material_id: raw!.id, core_id: cores[0].id, weight_grams: w, quantity: qty, unit_price: price });
            } else {
                entry.lines.push({ kind: 'core', raw_material_id: null, core_id: cores[0].id, inventory_item_id: null, core_material_id: null, quantity: qty, unit_price: price } as any);
            }
        } else if (kind === 'bobina') {
            const raw = findRaw();
            if (!raw) return errors.push({ row: rowNo, message: `Bobina madre no encontrada: "${ref}"` });
            entry.lines.push({ kind: 'bobina', raw_material_id: raw.id, core_id: null, inventory_item_id: null, core_material_id: null, quantity: qty, unit_price: price } as any);
        } else if (kind === 'insumo') {
            const it = cat.items.find((x) => (x.sku && norm(x.sku) === norm(ref)) || norm(x.name) === norm(ref));
            if (!it) return errors.push({ row: rowNo, message: `Producto no encontrado en Otros inventarios: "${ref}"` });
            entry.lines.push({ kind: 'insumo', raw_material_id: null, core_id: null, inventory_item_id: it.id, core_material_id: null, quantity: qty, unit_price: price } as any);
        } else if (kind === 'material_core') {
            const m = cat.coreMaterials.find((x) => norm(x.name) === norm(ref));
            if (!m) return errors.push({ row: rowNo, message: `Material de cores no encontrado: "${ref}"` });
            entry.lines.push({ kind: 'material_core', raw_material_id: null, core_id: null, inventory_item_id: null, core_material_id: m.id, quantity: qty, unit_price: price } as any);
        } else {
            return errors.push({ row: rowNo, message: `tipo no válido: "${get(r, 'tipo')}"` });
        }
        lineCount++;
    });

    return { data: Array.from(byClient.values()), errors, lineCount };
}
