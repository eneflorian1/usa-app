'use client';

import dynamic from 'next/dynamic';

const VoiceFAB = dynamic(() => import('./VoiceFAB'), { ssr: false });

export default function VoiceFABWrapper() {
    return <VoiceFAB />;
}
