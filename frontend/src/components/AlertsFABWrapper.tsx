'use client';

import dynamic from 'next/dynamic';

const AlertsFAB = dynamic(() => import('./AlertsFAB'), { ssr: false });

export default function AlertsFABWrapper() {
    return <AlertsFAB />;
}
