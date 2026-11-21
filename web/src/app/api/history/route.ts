import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/server/data';

/** Saved Kaggle-derived season averages. No external network requests. */
export async function GET() {
  try {
    const filePath = path.join(DATA_DIR, 'app', 'history.json');
    const seasons = JSON.parse(await readFile(filePath, 'utf8'));
    return NextResponse.json({ seasons });
  } catch {
    return NextResponse.json({ error: 'Season averages missing; rerun the local data builder.' }, { status: 500 });
  }
}
