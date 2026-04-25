# Government & Legal Compliance Checklist — NoQx Canteen App (India)

This document lists all certificates, registrations, and licences required to legally operate a canteen ordering app in India targeting institutions with ~15,000 students.

---

## 1. Food Safety & Hygiene

### FSSAI Licence (Mandatory)
- **Authority**: Food Safety and Standards Authority of India
- **Why**: Mandatory for any entity involved in food preparation, distribution, or aggregation (even a digital platform that facilitates food orders).
- **Type needed**:
  - **Basic Registration** — if annual turnover < ₹12 lakh (small canteen)
  - **State Licence** — if turnover ₹12 lakh – ₹20 crore
  - **Central Licence** — if turnover > ₹20 crore or operating across states
- **Portal**: [https://foscos.fssai.gov.in](https://foscos.fssai.gov.in)
- **Fee**: ₹100 (Basic) / ₹2,000–₹5,000 (State/Central)
- **Validity**: 1–5 years (renewable)

---

## 2. GST Registration (Mandatory)

- **Authority**: GST Council / GSTN
- **Why**: Required if annual turnover exceeds ₹20 lakh (₹10 lakh for special category states). Payments processed through Razorpay require a valid GSTIN for TDS compliance.
- **Documents needed**: PAN, Aadhaar, bank account, business address proof
- **Portal**: [https://www.gst.gov.in](https://www.gst.gov.in)
- **Fee**: Free
- **GST rate on food**: 5% (restaurant services, no ITC)

---

## 3. Business / Company Registration

### Sole Proprietorship / Partnership / LLP / Private Limited Company
- **Authority**: Ministry of Corporate Affairs (MCA) for LLP/Pvt Ltd
- **Why**: Needed to open a current bank account, collect payments, and sign contracts with institutions.
- **Recommended**: Register as a **Private Limited Company** or **LLP** for credibility with colleges.
- **Portal**: [https://www.mca.gov.in](https://www.mca.gov.in)
- **Fee**: ₹1,000–₹7,000 depending on type
- **Documents**: PAN, Aadhaar, photos, MOA/AOA (for Pvt Ltd), address proof

> **Note**: A sole proprietorship works for small setups but LLP/Pvt Ltd is strongly recommended at 15k-student scale.

---

## 4. MSME / Udyam Registration (Recommended)

- **Authority**: Ministry of Micro, Small & Medium Enterprises
- **Why**: Gives access to government schemes, subsidies, priority lending, and builds credibility.
- **Portal**: [https://udyamregistration.gov.in](https://udyamregistration.gov.in)
- **Fee**: Free
- **Documents**: Aadhaar + PAN (auto-fetches business data from IT Dept)

---

## 5. DLT Registration — TRAI (Critical for OTP SMS)

- **Authority**: TRAI (Telecom Regulatory Authority of India)
- **Why**: **All transactional/OTP SMS in India must be sent from a DLT-registered sender ID and template**. Without this, SMS OTPs will not be delivered. This is mandatory for the phone OTP login feature.
- **What to register**:
  - Entity (company) on a DLT platform
  - Sender ID / Header (e.g., NOQXAP)
  - Message Templates (OTP template must be pre-approved)
- **DLT Platforms** (choose one based on your SMS provider):
  - Airtel DLT: [https://www.airtel.in/business/dlt](https://www.airtel.in/business/dlt)
  - Vodafone-Idea: [https://www.vilpower.in](https://www.vilpower.in)
  - BSNL: [https://www.ucc-bsnl.co.in](https://www.ucc-bsnl.co.in)
  - Jio: [https://trueconnect.jio.com](https://trueconnect.jio.com)
- **Fee**: ₹500–₹6,000 (one-time entity registration depending on platform)
- **Timeline**: 3–7 working days

---

## 6. Data Protection — DPDPA 2023 (Mandatory)

- **Authority**: Ministry of Electronics & Information Technology (MeitY)
- **Why**: The **Digital Personal Data Protection Act, 2023** requires any app collecting personal data (name, phone, payment info) from Indian users to:
  - Publish a clear **Privacy Policy**
  - Obtain **explicit consent** before collecting data
  - Allow users to **withdraw consent and delete their data**
  - Appoint a **Data Protection Officer (DPO)** (if processing large volumes)
  - Report data breaches to the Data Protection Board within defined timelines
- **Action items for the app**:
  - [ ] Add Privacy Policy page
  - [ ] Add Terms of Service page
  - [ ] Add cookie/data consent banner
  - [ ] Build a "Delete My Account" flow for users
  - [ ] Create a data breach response procedure

---

## 7. Payment Aggregator / Razorpay KYC (Mandatory for Payouts)

- **Authority**: RBI (Payment Aggregator guidelines)
- **Why**: Razorpay (and any other PA) requires a completed KYC on your merchant account before activating settlements/payouts. This includes:
  - Business PAN
  - GSTIN
  - Bank account + cancelled cheque
  - Certificate of Incorporation / Partnership deed
  - Director/Partner Aadhaar + PAN
- **Portal**: [https://dashboard.razorpay.com](https://dashboard.razorpay.com) → Account & Settings → KYC
- **Payout feature**: Requires additionally applying for Razorpay Route / Payout product
- **RBI PA Licence**: Razorpay holds this — you don't need one separately as a merchant

---

## 8. Municipal / Local Trade Licence

- **Authority**: Local Municipal Corporation (varies by city)
- **Why**: Required for any physical establishment (canteen premises). Even if you are a tech platform, each canteen vendor should hold this separately.
- **Who applies**: Each canteen operator (vendor), not just the platform
- **Fee**: ₹500–₹5,000/year depending on the city
- **Renewal**: Annual

---

## 9. Professional Tax Registration (State-specific)

- **Authority**: State Government (Commercial Taxes Department)
- **Why**: Applicable in states like Karnataka, Maharashtra, Tamil Nadu, etc. if the business has employees.
- **Fee**: ₹2,500/year per employee (max, varies by state)

---

## 10. Institution MoU / Vendor Agreement

- **Authority**: The college / university / institution
- **Why**: Not a government certificate, but **legally essential** — you need a signed agreement with the institution that allows you to operate on campus, use their student data, and collect payments on their behalf.
- **What it should cover**:
  - Revenue sharing terms
  - Data ownership and privacy
  - Operational hours and scope
  - Termination clause
  - Liability for food quality (FSSAI compliance of vendors)

---

## Quick Checklist Summary

| # | Certificate / Licence | Mandatory? | Approx. Cost | Timeline |
|---|----------------------|------------|-------------|----------|
| 1 | FSSAI Licence (per canteen) | ✅ Yes | ₹100–₹5,000 | 7–30 days |
| 2 | GST Registration | ✅ Yes | Free | 3–7 days |
| 3 | Company/LLP Registration (MCA) | ✅ Yes | ₹1,000–₹7,000 | 7–15 days |
| 4 | MSME / Udyam Registration | ⚠️ Recommended | Free | Same day |
| 5 | DLT Registration (TRAI) for OTP SMS | ✅ Yes | ₹500–₹6,000 | 3–7 days |
| 6 | DPDPA 2023 Compliance (Privacy Policy etc.) | ✅ Yes | Legal fees | Ongoing |
| 7 | Razorpay KYC (for payouts) | ✅ Yes | Free | 2–5 days |
| 8 | Municipal Trade Licence (each canteen) | ✅ Yes | ₹500–₹5,000/yr | 7–14 days |
| 9 | Professional Tax (if you have employees) | State-specific | ₹2,500/yr | 3–5 days |
| 10 | Institution MoU / Vendor Agreement | ⚠️ Strongly recommended | Legal fees | Negotiated |

---

## Priority Order (Do in this order)

1. **Company Registration (MCA)** — everything else depends on this
2. **PAN + Bank Account** — needed for GST and Razorpay
3. **GST Registration** — needed for Razorpay KYC and billing
4. **Razorpay KYC** — needed before first real payment
5. **FSSAI** — for each canteen vendor going live
6. **DLT Registration** — critical to fix OTP SMS delivery for phone login
7. **Privacy Policy + Terms + DPDPA consent** — add to the app before public launch
8. **Municipal Trade Licence** — coordinate with each canteen vendor
9. **MSME / Udyam** — register once company is set up
10. **Institution MoU** — sign before deploying in each college

---

*Last updated: April 2026*
