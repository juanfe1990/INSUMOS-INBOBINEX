/** Tipo de documento con el que sale un pedido (orders.document_type). */
export type DocumentType = 'factura' | 'remision';

/** Filtro de reportes (income_statement / clients_dashboard: p_documents). */
export type DocumentFilter = 'todos' | 'factura' | 'remision';

export const DOCUMENT_FILTERS: { value: DocumentFilter; label: string }[] = [
    { value: 'todos', label: 'Facturados y remisionados' },
    { value: 'factura', label: 'Solo facturados' },
    { value: 'remision', label: 'Solo remisionados' },
];

export const DOCUMENT_LABEL: Record<DocumentType, string> = {
    factura: 'Factura',
    remision: 'Remisión',
};

export const documentFilterLabel = (f: DocumentFilter) =>
    DOCUMENT_FILTERS.find((d) => d.value === f)?.label ?? '';
