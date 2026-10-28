import {NextRequest,NextResponse} from 'next/server';
import {billingEnabled} from '../../../lib/billing/db';
import {POST as provider} from '../../../lib/providers/inventory-photo/route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function POST(request:NextRequest){
 if(billingEnabled())return NextResponse.json({error:'billing_client_required'},{status:426,headers:{'Cache-Control':'no-store'}});
 return provider(request);
}
