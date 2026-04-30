'use client';

import dynamic from 'next/dynamic';

const AssistantSetupBanner = dynamic(() => import('./AssistantSetupBanner'), { ssr: false });

export default function AssistantSetupBannerWrapper() {
    return <AssistantSetupBanner />;
}
