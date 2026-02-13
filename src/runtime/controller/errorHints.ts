export const shouldSuggestRecalibrationFromError = (error: string | null | undefined): boolean => {
    if (!error) {
        return false;
    }

    const message = error.toLowerCase();
    if (!message.includes('graphql request failed after retries')) {
        return false;
    }

    return (
        message.includes('response body empty') ||
        message.includes('status=500') ||
        message.includes('graphql request failed: 500') ||
        message.includes('<!doctype html') ||
        message.includes('id="facebook"')
    );
};
