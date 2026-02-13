import { describe, expect, it } from 'bun:test';
import { shouldSuggestRecalibrationFromError } from '@/runtime/controller/errorHints';

describe('error hints', () => {
    it('should detect stale-calibration graphql retry errors', () => {
        const message =
            'GraphQL request failed after retries. endpoint=/api/graphql/ params=19 error=GraphQL request failed: 500 preview="<html lang=\\"en\\" id=\\"facebook\\">"';
        expect(shouldSuggestRecalibrationFromError(message)).toBeTrue();
    });

    it('should ignore unrelated errors', () => {
        expect(shouldSuggestRecalibrationFromError('network disconnected')).toBeFalse();
        expect(shouldSuggestRecalibrationFromError(null)).toBeFalse();
    });

    it('should detect response body empty', () => {
        expect(
            shouldSuggestRecalibrationFromError('GraphQL request failed after retries. error=response body empty'),
        ).toBeTrue();
    });

    it('should detect status=500', () => {
        expect(shouldSuggestRecalibrationFromError('GraphQL request failed after retries. status=500')).toBeTrue();
    });

    it('should return false when prerequisite matches but no specific pattern does', () => {
        expect(shouldSuggestRecalibrationFromError('GraphQL request failed after retries. error=timeout')).toBeFalse();
    });

    it('should return false for undefined', () => {
        expect(shouldSuggestRecalibrationFromError(undefined)).toBeFalse();
    });

    it('should detect <!doctype html in preview', () => {
        expect(
            shouldSuggestRecalibrationFromError(
                'GraphQL request failed after retries. preview="<!doctype html><html>"',
            ),
        ).toBeTrue();
    });
});
