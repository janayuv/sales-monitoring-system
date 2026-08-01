import { SavedViewPreset } from "../../Table/types";

export interface CustomerFiltersState {
  searchQuery: string;
  matchStatus: string; // 'All' | 'Complete' | 'Incomplete' | 'Unmapped'
  categoryName: string; // 'All' | category name
  approvalStatus: string; // 'All' | 'Approved' | 'Pending_Review'
  location: string; // 'All' | location string
}

export const INITIAL_CUSTOMER_FILTERS: CustomerFiltersState = {
  searchQuery: "",
  matchStatus: "All",
  categoryName: "All",
  approvalStatus: "All",
  location: "All",
};

export const CUSTOMER_SAVED_PRESETS: SavedViewPreset[] = [
  {
    id: "all",
    name: "All Customers",
    isDefault: true,
    filters: { matchStatus: "All", approvalStatus: "All" },
  },
  {
    id: "verified_complete",
    name: "Verified Complete",
    filters: { matchStatus: "Complete" },
  },
  {
    id: "incomplete_mapping",
    name: "Incomplete Mappings",
    filters: { matchStatus: "Incomplete" },
  },
  {
    id: "unmapped",
    name: "Unmapped Accounts",
    filters: { matchStatus: "Unmapped" },
  },
  {
    id: "pending_review",
    name: "Pending Review",
    filters: { approvalStatus: "Pending_Review" },
  },
];
