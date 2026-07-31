export type InvoiceItemUpdatePayload = {
  id?: number | bigint | null;
  part_code: string;
  description?: string | null;
  quantity: number;
  rate_pre_unit: number;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
};
