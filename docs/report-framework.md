# Sales Monitoring System - Reporting Framework v1.0

This document defines the architectural standards, folder organization, DTO contracts, and layer responsibilities for all reports in the Sales Monitoring System.

---

## 1. Framework Architecture & Layer Responsibilities

```
                                  UI Component
                                       │
                                       ▼
                              reportExportService.ts
                               formatters.ts
                                       │
                                       ▼
                             ApiService (Frontend)
                                       │ (Tauri IPC)
                                       ▼
                          Tauri IPC Command Gateway
                            (export_commands.rs)
                                       │
                                       ▼
                            CategoryReportService
                                       │
                                       ▼
                           CategoryReportRepository
                            (ReportQueryBuilder)
                                       │
                                       ▼
                              SQLite Database
```

### Layer Responsibilities:
1. **Database**: Implements relational schema with indexed canonical foreign keys (e.g., `customers.category_id`).
2. **Repository (`reports/<feature>/repository.rs`)**: Encapsulates raw SQL execution. Uses `ReportQueryBuilder` to append `WHERE`, `ORDER BY`, and `LIMIT/OFFSET` clauses. Returns unrounded domain data.
3. **Query Builder (`reports/query_builder.rs`)**: Lightweight helper responsible exclusively for clause fragment building and parameter binding.
4. **Service (`reports/<feature>/service.rs`)**: Executes the standardized 8-step report processing lifecycle:
   - Step 1: Validate Filter (parse dates, validate inputs)
   - Step 2: Normalize Filter (set defaults)
   - Step 3: Build Query Clauses (via QueryBuilder)
   - Step 4: Execute Query (via Repository)
   - Step 5: Compute Grand Totals & Analytics
   - Step 6: Construct Response DTO & `ReportMetadata`
   - Step 7: Log Audit Telemetry
   - Step 8: Return DTO
5. **IPC Command Gateway (`commands/export_commands.rs`)**: Thin gateway converting IPC requests to service calls.
6. **Frontend API (`api.ts`)**: Strongly-typed wrappers invoking Tauri IPC commands.
7. **Frontend Component (`components/`)**: Handles UI state, cache ownership, dynamic sticky footers, and accessible progress bars.
8. **Export Service (`reportExportService.ts`)**: Centralized engine for exporting reports to Excel, CSV, Clipboard, and Print with explicit report-driven column ownership and shared formatters.

---

## 2. Directory Layout Conventions

```
src-tauri/src/reports/
├── mod.rs
├── constants.rs
├── common.rs
├── query_builder.rs
└── category/
    ├── mod.rs
    ├── models.rs
    ├── repository.rs
    └── service.rs
```

---

## 3. Data Transfer Objects (DTOs)

### Response Envelope (`ReportResult<R, G, F>`)
```rust
pub struct ReportResult<R, G, F> {
    pub metadata: ReportMetadata,
    pub filter: F,
    pub grand_totals: G,
    pub rows: Vec<R>,
}
```

### Shared Filter Base (`ReportFilterCommon`)
```rust
pub struct ReportFilterCommon {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub financial_year_id: Option<i64>,
    pub invoice_statuses: Option<Vec<String>>,
    pub include_cancelled: Option<bool>,
    pub search_term: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}
```

---

## 4. Performance SLA Benchmarks

- **10,000 Invoices**: `< 200 ms`
- **50,000 Invoices**: `< 500 ms`
- **100,000 Invoices**: `< 1,000 ms`

---

## 5. Export Metadata Header Standard

All exports (Excel, CSV, PDF, Print) embed a standard header block:
- **Report Title** & Version
- **Company Profile Name** & GSTIN
- **Date Range / Financial Year**
- **Applied Filters**
- **Generation Timestamp** & User Name
