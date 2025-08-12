import { NextRequest, NextResponse } from 'next/server';
import libnpmorg from 'libnpmorg';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const org = searchParams.get('org');

  try {
    if (!process.env.NPM_TOKEN) {
      throw new Error(`Env variable NPM_TOKEN not configured`);
    }

    if (!org) {
      throw new Error('Organization parameter is required');
    }

    const users = await libnpmorg.ls(org, {
      '//registry.npmjs.org/:_authToken': process.env.NPM_TOKEN,
    });

    const userList = Object.entries(users).map(([name, role]: [string, any]) => ({
      name,
      role,
    }));

    return NextResponse.json(userList);
  } catch (error) {
    console.error('Error fetching npm users:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch users' },
      { status: 500 }
    );
  }
}