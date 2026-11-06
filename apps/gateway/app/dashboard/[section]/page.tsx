import { notFound } from 'next/navigation';
import { Dashboard } from '../dashboard';
import { sections, type Section } from '../types';
export default async function DashboardSection({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; if (!sections.includes(section as Section)) notFound(); return <Dashboard section={section as Section} />; }
