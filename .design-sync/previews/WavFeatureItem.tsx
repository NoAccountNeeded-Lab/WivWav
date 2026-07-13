import { WavFeatureItem } from '@wivwav/web'

function DotIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden focusable="false">
      <circle cx={8} cy={8} r={6} fill="currentColor" />
    </svg>
  )
}

export function TransferSeat() {
  return <WavFeatureItem icon={<DotIcon />} label="Transfer Seat" value="Included" />
}

export function WheelchairLift() {
  return <WavFeatureItem icon={<DotIcon />} label="Wheelchair Lift" value="Included" />
}

export function FloorLowering() {
  return <WavFeatureItem icon={<DotIcon />} label="Floor lowering" value="10 inches" />
}
