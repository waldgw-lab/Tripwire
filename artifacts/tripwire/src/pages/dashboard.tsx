import { PageHead } from '@/components/bits';
import { Importer } from '@/components/importer';

export default function DashboardPage() {
  return (
    <div className="tw-rise">
      <PageHead title="Dashboard" />
      <div className="mx-auto w-full max-w-[1000px] px-5 py-6 md:px-8">
        <Importer />
      </div>
    </div>
  );
}
