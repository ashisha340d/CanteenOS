import { useNavigate } from 'react-router-dom';
import type { DocumentFlowDto, DocumentFlowNodeDto } from '@menuboard/shared';
import { MARG_BEVEL_OUT, MARG_LABEL, margAmount } from '../Pos/margChrome';

export interface DocumentFlowPanelProps {
  flow: DocumentFlowDto | undefined;
  isLoading: boolean;
  error: unknown;
}

/**
 * The chain a purchase produced — entry → goods receipt → invoice → ledger → payment — as one
 * horizontal run of clickable nodes. This is the answer to "where did this stock come from".
 */
export function DocumentFlowPanel({ flow, isLoading, error }: DocumentFlowPanelProps): JSX.Element {
  const navigate = useNavigate();

  if (isLoading) {
    return <Shell>
      <span className={MARG_LABEL}>LOADING FLOW…</span>
    </Shell>;
  }
  if (error !== null && error !== undefined) {
    return <Shell>
      <span className="bg-[#a80000] px-1 font-bold text-white">FLOW UNAVAILABLE</span>
    </Shell>;
  }
  if (flow === undefined || flow.nodes.length === 0) {
    return <Shell>
      <span className={MARG_LABEL}>NOT POSTED — NO DOCUMENTS YET</span>
    </Shell>;
  }

  return (
    <Shell>
      {flow.nodes.map((node: DocumentFlowNodeDto, index) => (
        <span key={`${node.documentType}-${node.documentId}`} className="flex items-center gap-1">
          {index > 0 && <span className="px-[2px] text-[#2e6f6a]">→</span>}
          <button
            type="button"
            disabled={node.href === null}
            className={`${MARG_BEVEL_OUT} flex items-baseline gap-1 bg-[#c8d1ce] px-1.5 py-[1px] text-left uppercase disabled:text-[#5f7370]`}
            onClick={() => {
              if (node.href !== null) navigate(node.href);
            }}
          >
            <span className={`text-[11px] font-bold ${MARG_LABEL}`}>{node.label}</span>
            <span className="text-[12px] font-bold tabular-nums">{node.documentNumber}</span>
            <span className="text-[11px]">{node.status}</span>
            {node.amount !== null && (
              <span className="text-[12px] tabular-nums">{margAmount(node.amount)}</span>
            )}
          </button>
        </span>
      ))}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-[#7d9490] bg-[#dfe6e2] px-1.5 py-[2px] font-mono text-[12px] leading-[16px] text-black">
      <span className={`pr-1 text-[11px] font-bold ${MARG_LABEL}`}>FLOW:</span>
      {children}
    </div>
  );
}
