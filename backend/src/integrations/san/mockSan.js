/**
 * Mock SAN/SIR application (Decision I-7: mock until the real API is available).
 * Data comes from the "For Data" sheet of "IMIR Sample formats - Review.xlsx" (item 123456).
 * Vendor '*' matches any vendor.
 */
const FIXTURES = [
  {
    vendorCode: '*',
    itemCode: '123456',
    reference: 'SAN-MOCK-123456',
    checkpoints: [
      { section: 'DIMENSIONAL', checkpoint: 'Dimensions', specification: '57', nominal: 57, lsl: 56.7, usl: 57.3, uom: 'mm', instrument: 'DVC' },
      { section: 'DIMENSIONAL', checkpoint: 'Dimensions', specification: '22.2', nominal: 22.2, lsl: 22, usl: 22.4, uom: 'mm', instrument: 'DVC' },
      { section: 'DIMENSIONAL', checkpoint: 'Dimensions', specification: '40.2', nominal: 40.2, lsl: 39.9, usl: 40.5, uom: 'mm', instrument: 'DVC' },
      { section: 'DIMENSIONAL', checkpoint: 'Dimensions', specification: '14', nominal: 14, lsl: 13.8, usl: 14.2, uom: 'mm', instrument: 'DVC' },
      { section: 'DIMENSIONAL', checkpoint: 'Angle', specification: '90', nominal: 90, lsl: 89.5, usl: 90.5, uom: '°', instrument: 'Bevel Protractor' },
      { section: 'VISUAL', checkpoint: 'Aesthetic', specification: 'Free from dust, rust, oil, crack, sharp edges & burr', instrument: 'Visual' },
      { section: 'VISUAL', checkpoint: 'Aesthetic', specification: 'Weld position should be ground', instrument: 'Visual' },
      { section: 'RELIABILITY', checkpoint: 'Static Load Test', specification: '200 kg load should be applied in vertical position', uom: 'kg', instrument: 'Static Load Jig', frequencyMonths: 6 },
      { section: 'RELIABILITY', checkpoint: 'Permanent Deformation', specification: 'Should be allowable up to 0° for 5 minutes', instrument: 'Static Load Jig', frequencyMonths: 6 },
    ],
  },
];

export const mockSanClient = {
  name: 'mock',
  async lookup({ vendorCode, itemCode }) {
    const hit = FIXTURES.find((f) => f.itemCode === itemCode && (f.vendorCode === '*' || f.vendorCode === vendorCode));
    if (!hit) return { found: false };
    return {
      found: true,
      reference: hit.reference,
      checkpoints: hit.checkpoints.map((c) => ({ ...c })),
    };
  },
};
