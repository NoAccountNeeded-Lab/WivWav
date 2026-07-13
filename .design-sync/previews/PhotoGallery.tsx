import { PhotoGallery } from '@wivwav/web'

const vanImages = [
  'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800',
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800',
  'https://images.unsplash.com/photo-1494905998402-395d579af36f?w=800',
  'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800',
  'https://images.unsplash.com/photo-1541447271487-09612b3f49f7?w=800',
]

export function Default() {
  return (
    <div style={{ width: 480, height: 320 }}>
      <PhotoGallery images={vanImages} alt="2021 Toyota Sienna Autobot VMI wheelchair van" />
    </div>
  )
}

export function SinglePhoto() {
  return (
    <div style={{ width: 480, height: 320 }}>
      <PhotoGallery images={[vanImages[0]!]} alt="2019 Dodge Grand Caravan BraunAbility" />
    </div>
  )
}

export function NoPhotos() {
  return (
    <div style={{ width: 480, height: 320 }}>
      <PhotoGallery images={[]} alt="2018 Honda Odyssey VMI Northstar" placeholderLabel="No photo available" />
    </div>
  )
}

export function WithOverlays() {
  return (
    <div style={{ width: 480, height: 320 }}>
      <PhotoGallery
        images={vanImages}
        alt="2022 Chrysler Pacifica BraunAbility Rampvan"
        topOverlay={<span style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>$41,200</span>}
        bottomOverlay={<span style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>Columbus, OH</span>}
      />
    </div>
  )
}
