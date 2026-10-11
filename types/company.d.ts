// Data model shared by the background, content scripts, popup and viewer.

type CompanyGroup =
  'identity' | 'tax' | 'address' | 'contact' | 'manager' | 'bank' | 'accounting' | 'erp';

interface LegalFormRef {
  key: string;
  code: string;
  short: string;
  label: string;
}

interface Company {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  identity: {
    legalName: string;
    legalNameShort: string;
    tradeName: string;
    legalForm: LegalFormRef;
    siren: string;
    nic: string;
    siret: string;
    creationDate: string;
    rcs: string;
  };
  tax: {
    vatNumber: string;
    nafCode: string;
    nafLabel: string;
    nafCodeRev2: string;
    nafLabelRev2: string;
    nafFamily: string;
    shareCapital: number | null;
    headcountBand: { code: string; label: string };
    vatRegime: string;
    vatCode: string;
  };
  address: {
    streetNumber: string;
    streetNumberSuffix: string;
    streetType: string;
    streetTypeShort: string;
    streetName: string;
    line1: string;
    line1Short: string;
    line2: string;
    postalCode: string;
    city: string;
    inseeCode: string;
    departmentCode: string;
    departmentName: string;
    regionCode: string;
    region: string;
    country: string;
    countryName: string;
    latitude: number;
    longitude: number;
  };
  contact: {
    phone: string;
    email: string;
    website: string;
  };
  manager: {
    title: 'M.' | 'Mme';
    gender: 'male' | 'female';
    firstName: string;
    lastName: string;
    role: string;
    mobile: string;
    email: string;
  };
  bank: {
    bankName: string;
    bankCode: string;
    branchCode: string;
    accountNumber: string;
    ribKey: string;
    iban: string;
    bic: string;
  };
  accounting: {
    customerCode: string;
    supplierCode: string;
    customerAccount: string;
    supplierAccount: string;
    auxiliaryAccount: string;
    paymentMethod: string;
    paymentTerms: string;
    currency: string;
    creditLimit: number;
  };
  erp: {
    erpCompanyCode: string;
    erpSiteCode: string;
    gln: string;
    internalRef: string;
    uuid: string;
  };
}

/** Static data loaded once by the background (extension/data/fr). */
interface CompanyData {
  naf: NafEntry[];
  legalForms: LegalFormEntry[];
  headcount: Record<string, string>;
  firstNames: { female: string[]; male: string[] };
  lastNames: string[];
  streets: {
    types: Array<{ name: string; short: string; weight: number }>;
    names: string[];
    complements: string[];
  };
  words: {
    patterns: Record<string, string[]>;
    places: string[];
    areas: string[];
    tech: string[];
    forbidden: string[];
  };
  banks: Array<{ name: string; bankCode: string; bic: string }>;
  departments: DepartmentEntry[];
}

interface NafEntry {
  code: string;
  label: string;
  rev2: string;
  rev2Label: string;
  family: string;
  trades: string[];
}

interface LegalFormEntry extends LegalFormRef {
  weight: number;
  capital: [number, number] | null;
  role: string;
  roleFeminine: string;
  families: string[];
  headcount: string[];
  minDate: string;
  rcsLetter: string;
}

interface DepartmentEntry {
  code: string;
  name: string;
  region: string;
  regionName: string;
  prefecture: string;
  population: number;
  phoneZone: string;
}

/** [INSEE code, name, postal code(s), population, latitude, longitude] */
type CommuneRow = [string, string, string | string[], number, number, number];

/** Access to the static data, with communes loaded per department. */
interface CompanyDataSource {
  load(): Promise<CompanyData>;
  communes(departmentCode: string): Promise<CommuneRow[]>;
}
