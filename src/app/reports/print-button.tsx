'use client';

import type { ReactNode } from 'react';

export function PrintButton({children}:{children:ReactNode}){
  return <button type="button" className="workspace-small-action no-print" onClick={()=>window.print()}>{children}</button>;
}
