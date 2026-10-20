import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  VERIFIED_VISIT_REPORT_REASONS,
  isVerifiedVisitReportReason,
} from '@/lib/verified-visit-report-reasons';

describe('verified visit report reasons', () => {
  it('offers a bounded set, with no free-text option', () => {
    // Free text is how personal data reaches a moderation queue, and it makes
    // reports uncountable. "Something else" is the escape hatch instead.
    expect(VERIFIED_VISIT_REPORT_REASONS.length).toBeGreaterThanOrEqual(6);
    expect(VERIFIED_VISIT_REPORT_REASONS.map((r) => r.value)).toContain('other');
    for (const reason of VERIFIED_VISIT_REPORT_REASONS) {
      expect(reason.label.length).toBeGreaterThan(0);
      expect(reason.value).toMatch(/^[a-z_]+$/);
    }
  });

  it('covers the categories Play expects a report flow to offer', () => {
    const values = VERIFIED_VISIT_REPORT_REASONS.map((r) => r.value);
    for (const required of ['offensive', 'sexual_content', 'violence', 'spam']) {
      expect(values).toContain(required);
    }
  });

  it('rejects anything outside the list', () => {
    expect(isVerifiedVisitReportReason('offensive')).toBe(true);
    for (const bad of ['', 'OFFENSIVE', 'drop table', null, undefined, 7, {}]) {
      expect(isVerifiedVisitReportReason(bad)).toBe(false);
    }
  });

  // The app cannot import from hub-page, so the list is a deliberate copy in
  // three places. These two read the other copies and compare, so drift fails
  // here rather than as a 400 on a member's device.
  it('matches the server-side list in hub-page', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../hub-page/src/lib/merchants/verifiedVisitReports.ts'),
      'utf8',
    );
    const serverValues = [...source.matchAll(/\{ value: "([a-z_]+)"/g)].map((m) => m[1]);

    expect(serverValues.length).toBeGreaterThan(0);
    expect(new Set(serverValues)).toEqual(new Set(VERIFIED_VISIT_REPORT_REASONS.map((r) => r.value)));
  });

  it('matches the database CHECK constraint', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../../../supabase/migrations/104_verified_visit_reports.sql'),
      'utf8',
    );
    const check = /reason_code\s+text NOT NULL CHECK \(reason_code IN \(([\s\S]*?)\)\)/.exec(migration);
    expect(check).not.toBeNull();

    const dbValues = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(dbValues)).toEqual(new Set(VERIFIED_VISIT_REPORT_REASONS.map((r) => r.value)));
  });
});
