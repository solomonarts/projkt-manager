'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

export async function createJournalEntry(formData: FormData) {
  const description=String(formData.get('description')??'').trim();
  const entryDate=String(formData.get('entry_date')??'');
  const periodId=String(formData.get('period_id')??'');
  const debitAccount=String(formData.get('debit_account')??'');
  const creditAccount=String(formData.get('credit_account')??'');
  const amount=Number(formData.get('amount'));
  if(!description||!entryDate||!periodId||!debitAccount||!creditAccount||debitAccount===creditAccount||!Number.isFinite(amount)||amount<=0) throw new Error('Complete the journal details with two different accounts and a positive amount.');
  const {supabase}=await requirePermission('accounting.manage');
  const {error}=await supabase.rpc('create_journal_entry',{
    entry_description:description,entry_reference:String(formData.get('reference')??'').trim()||null,
    entry_date:entryDate,target_period:periodId,debit_account:debitAccount,credit_account:creditAccount,entry_amount:amount,
  });
  if(error) throw new Error(error.message);
  revalidatePath('/accounting');
}

export async function postJournalEntry(formData: FormData) {
  const entryId=String(formData.get('entry_id')??'');
  if(!entryId) throw new Error('Missing journal entry.');
  const {supabase}=await requirePermission('accounting.approve');
  const {error}=await supabase.rpc('post_journal_entry',{target_entry:entryId});
  if(error) throw new Error(error.message);
  revalidatePath('/accounting');
}

export async function createAccountingPeriod(formData:FormData){
  const name=String(formData.get('name')??'').trim();
  const startsOn=String(formData.get('starts_on')??'');
  const endsOn=String(formData.get('ends_on')??'');
  if(!name||!startsOn||!endsOn||endsOn<startsOn)throw new Error('Enter a period name and valid start and end dates.');
  const {supabase}=await requirePermission('accounting.manage');
  const {error}=await supabase.from('accounting_periods').insert({name,starts_on:startsOn,ends_on:endsOn});
  if(error)throw new Error(error.message);
  revalidatePath('/accounting');
}

export async function createAccount(formData:FormData){
  const code=String(formData.get('code')??'').trim();
  const name=String(formData.get('name')??'').trim();
  const type=String(formData.get('account_type')??'');
  if(!code||!name||!['asset','liability','equity','revenue','expense'].includes(type))throw new Error('Enter an account code, name, and valid account type.');
  const {supabase}=await requirePermission('accounting.manage');
  const {error}=await supabase.from('chart_of_accounts').insert({code,name,account_type:type});
  if(error)throw new Error(error.message);
  revalidatePath('/accounting');
}
