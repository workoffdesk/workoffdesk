import { useState } from 'react';
import { ActionSheet } from './ActionSheet';

// Something that cannot be undone asks first, in the card the phone's alert is: what it is, then Cancel
// beside the action.
export function ConfirmButton(props: {
  label: string;
  title: string;
  what?: string;
  action: string;
  destructive?: boolean;
  disabled: boolean;
  onConfirm: () => void;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button className={props.className ?? 'btn small danger'} disabled={props.disabled} onClick={() => setAsking(true)}>
        {props.label}
      </button>
      {asking && (
        <ActionSheet
          title={props.title}
          message={props.what}
          side
          actions={[{ label: props.action, run: props.onConfirm, destructive: props.destructive }]}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  );
}
