import { Suspense } from 'react';

import { PageLoader } from '@/components/common';
import { PlayerView } from '@/components/player/PlayerView';

async function PlayerPageContent({ params }: { params: PageProps<'/players/[id]'>['params'] }) {
  const { id } = await params;
  return <PlayerView id={Number(id)} />;
}

export default function PlayerPage({ params }: PageProps<'/players/[id]'>) {
  return (
    <Suspense fallback={<PageLoader />}>
      <PlayerPageContent params={params} />
    </Suspense>
  );
}
