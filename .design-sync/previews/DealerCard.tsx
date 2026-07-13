import { DealerCard } from '@wivwav/web'

const dealer = {
  name: 'Meridian Mobility Vans',
  phone: '(614) 555-0142',
  website: 'meridianmobilityvans.com',
}

const location = { city: 'Columbus', state: 'OH', zip: '43215' }

export function Default() {
  return (
    <DealerCard
      dealer={dealer}
      location={location}
      sellerType="dealer"
      listingUrl="https://example.com/listing/123"
      priceLabel="$38,900"
    />
  )
}

export function PrivateSeller() {
  return (
    <DealerCard
      dealer={{ name: 'Janet R.', phone: '(614) 555-0199', website: null }}
      location={{ city: 'Dublin', state: 'OH', zip: null }}
      sellerType="private"
      priceLabel="$24,500"
    />
  )
}
