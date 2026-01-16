export const PAY_TYPES = [
  { value: 'cpm', label: 'Cents Per Mile (CPM)' },
  { value: 'percentage', label: 'Percentage of Load (%)' },
  { value: 'flatRate', label: 'Flat Weekly Rate ($)' },
  { value: 'hourly', label: 'Hourly Rate ($)' }
];

export const EXPERIENCE_LEVELS = [
  { value: 'lessThan6Months', label: 'Less than 6 Months' },
  { value: 'lessThan1Year', label: 'Less than 1 Year' },
  { value: 'moreThan1Year', label: 'More than 1 Year' },
  { value: 'moreThan2Years', label: 'More than 2 Years' },
  { value: 'moreThan5Years', label: 'More than 5 Years' }
];

export const FREIGHT_TYPES = [
  "Dry Van", "Reefer", "Flatbed", "Tanker", "Box Truck",
  "Car Hauler", "Step Deck", "Lowboy", "Conestoga",
  "Intermodal", "Power Only", "Hotshot"
];

export const BENEFITS_LIST = [
  { id: 'healthInsurance', label: 'Health Insurance' },
  { id: 'dental', label: 'Dental Insurance' },
  { id: 'vision', label: 'Vision Insurance' },
  { id: 'retirement401k', label: '401(k) Retirement' },
  { id: 'signOnBonus', label: 'Sign-on Bonus' },
  { id: 'petPolicy', label: 'Pet Policy' },
  { id: 'riderPolicy', label: 'Rider Policy' },
  { id: 'newEquipment', label: 'New Equipment (2022+)' },
  { id: 'fuelCard', label: 'Fuel Card / Discounts' },
  { id: 'paidOrientation', label: 'Paid Orientation' }
];

export const INITIAL_SUB_POSITION_STATE = {
  enabled: false,
  payType: 'cpm',
  cpm: { min: '', max: '' },
  percentage: { min: '', max: '' },
  flatRate: { amount: '' },
  hourly: { amount: '' },
  experienceRequired: 'moreThan1Year',
  hiringGeography: {
    nationwide: true,
    states: []
  },
  freightTypes: [],
  homeTime: 'Weekly',
  benefits: {}
};

export const INITIAL_HIRING_STATE = {
  companyDriver: {
    enabled: false,
    solo: { ...INITIAL_SUB_POSITION_STATE },
    team: { ...INITIAL_SUB_POSITION_STATE }
  },
  ownerOperator: {
    enabled: false,
    solo: { ...INITIAL_SUB_POSITION_STATE },
    team: { ...INITIAL_SUB_POSITION_STATE }
  },
  leaseOperator: {
    enabled: false,
    solo: { ...INITIAL_SUB_POSITION_STATE },
    team: { ...INITIAL_SUB_POSITION_STATE }
  },
  benefits: {
    coversTransportation: false,
    coversHotel: false
  }
};
