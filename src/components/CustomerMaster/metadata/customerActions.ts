import { Edit3, Copy, FileText, CheckCircle } from "lucide-react";
import { RowActionDefinition } from "../../Table/types";
import { CustomerMasterRow } from "../../../types/bindings/CustomerMasterRow";

export function createCustomerRowActions(handlers: {
  onEdit: (row: CustomerMasterRow) => void;
  onCopyCode: (code: string) => void;
  onCopyGstin: (gstin: string) => void;
  onQuickApprove?: (row: CustomerMasterRow) => void;
}): RowActionDefinition<CustomerMasterRow>[] {
  return [
    {
      id: "edit",
      label: "Edit Customer Profile",
      icon: Edit3,
      shortcut: "Double Click",
      onClick: handlers.onEdit,
      dividerAfter: true,
    },
    {
      id: "copy_code",
      label: "Copy Customer Code",
      icon: Copy,
      onClick: (r) => handlers.onCopyCode(r.customer_code),
    },
    {
      id: "copy_gstin",
      label: "Copy GSTIN Number",
      icon: FileText,
      disabled: (r) => !r.gstin,
      onClick: (r) => r.gstin && handlers.onCopyGstin(r.gstin),
      dividerAfter: true,
    },
    {
      id: "quick_approve",
      label: "Mark as Approved",
      icon: CheckCircle,
      hidden: (r) => r.status === "Approved",
      onClick: (r) => handlers.onQuickApprove?.(r),
    },
  ];
}
