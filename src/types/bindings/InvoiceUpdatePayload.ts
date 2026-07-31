import { InvoiceItemUpdatePayload } from "./InvoiceItemUpdatePayload";

export type InvoiceUpdatePayload = {
  invoice_number: string;
  expected_version: number;
  customer_id: number | bigint;
  place_of_supply?: string | null;
  reverse_charge?: string | null;
  invoice_type?: string | null;
  irn?: string | null;
  irn_date?: string | null;
  status: string;
  edit_reason: string;
  items: InvoiceItemUpdatePayload[];
};
