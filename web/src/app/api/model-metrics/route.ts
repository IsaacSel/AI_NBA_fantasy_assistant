import { getModelMetrics } from '@/lib/server/data';
export async function GET() {
  return Response.json(await getModelMetrics());
}
