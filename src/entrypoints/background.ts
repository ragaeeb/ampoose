import { defineBackground } from 'wxt/utils/define-background';
import { registerBackgroundListeners } from '@/background/service';

export default defineBackground(() => {
    registerBackgroundListeners();
});
