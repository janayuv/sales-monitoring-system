use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct EInvoiceDoc {
    pub version: String,
    pub tran_dtls: TranDtls,
    pub doc_dtls: DocDtls,
    pub seller_dtls: SellerDtls,
    pub buyer_dtls: BuyerDtls,
    pub val_dtls: ValDtls,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_dtls: Option<RefDtls>,
    pub item_list: Vec<EInvoiceItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct TranDtls {
    pub tax_sch: String,
    pub sup_typ: String,
    pub igst_on_intra: String,
    pub reg_rev: String,
    pub ecm_gstin: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct DocDtls {
    pub typ: String,
    pub no: String,
    pub dt: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct SellerDtls {
    pub gstin: String,
    pub lgl_nm: String,
    pub addr1: String,
    pub addr2: Option<String>,
    pub loc: String,
    pub pin: u32,
    pub stcd: String,
    pub ph: Option<String>,
    pub em: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct BuyerDtls {
    pub gstin: String,
    pub lgl_nm: String,
    pub addr1: String,
    pub addr2: Option<String>,
    pub loc: String,
    pub pin: u32,
    pub pos: String,
    pub stcd: String,
    pub ph: Option<String>,
    pub em: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct ValDtls {
    pub ass_val: f64,
    pub igst_val: f64,
    pub cgst_val: f64,
    pub sgst_val: f64,
    pub ces_val: f64,
    pub st_ces_val: f64,
    pub discount: f64,
    pub oth_chrg: f64,
    pub rnd_off_amt: f64,
    pub tot_inv_val: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct RefDtls {
    pub inv_rm: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct EInvoiceItem {
    pub sl_no: String,
    pub prd_desc: String,
    pub is_servc: String,
    pub hsn_cd: String,
    pub qty: f64,
    pub free_qty: f64,
    pub unit: String,
    pub unit_price: f64,
    pub tot_amt: f64,
    pub discount: f64,
    pub pre_tax_val: f64,
    pub ass_amt: f64,
    pub gst_rt: f64,
    pub igst_amt: f64,
    pub cgst_amt: f64,
    pub sgst_amt: f64,
    pub ces_rt: f64,
    pub ces_amt: f64,
    pub ces_non_advl_amt: f64,
    pub state_ces_rt: f64,
    pub state_ces_amt: f64,
    pub state_ces_non_advl_amt: f64,
    pub oth_chrg: f64,
    pub tot_item_val: f64,
}
