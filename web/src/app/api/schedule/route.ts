import { getSchedule } from '@/lib/server/data';

export async function GET() {
  return Response.json(await getSchedule());
}
