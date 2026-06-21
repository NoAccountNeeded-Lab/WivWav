/**
 * Decorative US map background with purple dot markers.
 * Rendered as a static SVG — zero JS weight, aria-hidden.
 * Dots are clustered around US population centers to suggest
 * "vehicles are available everywhere."
 */
export function UsMapBackground() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 960 600"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0.09,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
    >
      {/* Simplified US continental outline */}
      <path
        d="
          M 120 150
          L 140 120 L 170 105 L 210 95 L 260 90
          L 310 88 L 370 85 L 420 82 L 470 80
          L 520 80 L 570 82 L 620 85 L 660 88
          L 700 90 L 740 95 L 780 105 L 820 120
          L 840 140 L 850 165 L 845 190
          L 830 210 L 815 230 L 810 255
          L 820 270 L 835 280 L 840 300
          L 835 320 L 820 335 L 800 345
          L 790 360 L 795 375 L 800 395
          L 790 415 L 770 430 L 750 440
          L 730 445 L 700 448 L 670 445
          L 640 440 L 610 432 L 580 425
          L 550 420 L 520 418 L 490 418
          L 460 420 L 430 425 L 400 430
          L 370 432 L 340 430 L 310 425
          L 280 418 L 255 410 L 235 400
          L 220 385 L 210 368 L 205 350
          L 200 330 L 195 310 L 190 290
          L 182 270 L 170 255 L 155 245
          L 140 235 L 130 220 L 120 200
          L 115 180 L 118 160 Z
        "
        fill="var(--clr-primary, #5c35c6)"
        stroke="var(--clr-primary, #5c35c6)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fillOpacity="0.15"
      />

      {/* Florida peninsula */}
      <path
        d="M 670 445 L 680 460 L 685 480 L 688 505 L 685 530 L 675 545 L 660 550 L 645 545 L 638 530 L 640 510 L 645 490 L 648 470 L 650 450 Z"
        fill="var(--clr-primary, #5c35c6)"
        fillOpacity="0.15"
        stroke="var(--clr-primary, #5c35c6)"
        strokeWidth="1.5"
      />

      {/* Alaska (small inset, bottom-left) */}
      <path
        d="M 110 480 L 130 470 L 155 465 L 180 462 L 200 465 L 215 475 L 220 490 L 210 505 L 190 512 L 165 515 L 140 510 L 120 500 Z"
        fill="var(--clr-primary, #5c35c6)"
        fillOpacity="0.15"
        stroke="var(--clr-primary, #5c35c6)"
        strokeWidth="1.5"
      />

      {/* Hawaii (small inset) */}
      <ellipse cx="285" cy="510" rx="18" ry="10" fill="var(--clr-primary, #5c35c6)" fillOpacity="0.15" />
      <ellipse cx="315" cy="515" rx="14" ry="8" fill="var(--clr-primary, #5c35c6)" fillOpacity="0.15" />
      <ellipse cx="340" cy="518" rx="10" ry="6" fill="var(--clr-primary, #5c35c6)" fillOpacity="0.15" />

      {/* Dot markers — clustered around US population centers */}
      {/* New York metro */}
      <circle cx="810" cy="148" r="5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="820" cy="160" r="3.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="800" cy="160" r="3" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="815" cy="172" r="4" fill="var(--clr-primary, #5c35c6)" />

      {/* Boston */}
      <circle cx="840" cy="130" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="848" cy="142" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Philadelphia / DC / Baltimore */}
      <circle cx="795" cy="178" r="4.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="780" cy="190" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="770" cy="200" r="3.5" fill="var(--clr-primary, #5c35c6)" />

      {/* Atlanta */}
      <circle cx="720" cy="330" r="5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="730" cy="342" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Miami / South Florida */}
      <circle cx="685" cy="505" r="4.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="675" cy="495" r="3" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="695" cy="515" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Orlando */}
      <circle cx="720" cy="460" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="710" cy="472" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Chicago */}
      <circle cx="638" cy="185" r="5.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="648" cy="195" r="3.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="628" cy="198" r="3" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="642" cy="208" r="4" fill="var(--clr-primary, #5c35c6)" />

      {/* Detroit */}
      <circle cx="695" cy="175" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="705" cy="185" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Cleveland / Pittsburgh */}
      <circle cx="740" cy="185" r="3.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="755" cy="200" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Minneapolis */}
      <circle cx="560" cy="148" r="4.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="572" cy="158" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* St. Louis / Kansas City */}
      <circle cx="590" cy="248" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="530" cy="245" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="540" cy="258" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Dallas / Fort Worth */}
      <circle cx="540" cy="360" r="5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="555" cy="370" r="3.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="528" cy="372" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Houston */}
      <circle cx="565" cy="410" r="5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="578" cy="420" r="3.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="552" cy="422" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* San Antonio / Austin */}
      <circle cx="510" cy="400" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="498" cy="388" r="3.5" fill="var(--clr-primary, #5c35c6)" />

      {/* Denver */}
      <circle cx="388" cy="238" r="4.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="400" cy="248" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Phoenix */}
      <circle cx="280" cy="340" r="5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="292" cy="352" r="3.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="268" cy="352" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Las Vegas */}
      <circle cx="228" cy="288" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="240" cy="298" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Los Angeles / San Diego */}
      <circle cx="168" cy="310" r="5.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="180" cy="322" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="156" cy="322" r="3.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="172" cy="335" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="172" cy="348" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* San Francisco / Bay Area */}
      <circle cx="148" cy="240" r="4.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="158" cy="250" r="3.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="138" cy="252" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Portland / Seattle */}
      <circle cx="162" cy="148" r="4.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="172" cy="130" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="150" cy="130" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Salt Lake City */}
      <circle cx="302" cy="218" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="314" cy="228" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Albuquerque */}
      <circle cx="348" cy="318" r="4" fill="var(--clr-primary, #5c35c6)" />

      {/* New Orleans */}
      <circle cx="635" cy="405" r="4.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="648" cy="415" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Nashville / Memphis */}
      <circle cx="668" cy="290" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="620" cy="298" r="3.5" fill="var(--clr-primary, #5c35c6)" />

      {/* Charlotte / Raleigh */}
      <circle cx="748" cy="268" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="762" cy="255" r="3" fill="var(--clr-primary, #5c35c6)" />

      {/* Indianapolis / Columbus */}
      <circle cx="670" cy="228" r="4" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="715" cy="218" r="3.5" fill="var(--clr-primary, #5c35c6)" />

      {/* Omaha */}
      <circle cx="528" cy="198" r="3.5" fill="var(--clr-primary, #5c35c6)" />

      {/* Oklahoma City */}
      <circle cx="520" cy="318" r="4" fill="var(--clr-primary, #5c35c6)" />

      {/* Scattered rural dots to fill coverage gaps */}
      <circle cx="440" cy="168" r="3" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="468" cy="218" r="2.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="410" cy="295" r="2.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="458" cy="308" r="2.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="598" cy="178" r="2.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="340" cy="178" r="2.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="248" cy="208" r="2.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="780" cy="145" r="2.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="688" cy="365" r="2.5" fill="var(--clr-primary, #5c35c6)" />
      <circle cx="595" cy="335" r="2.5" fill="var(--clr-primary, #5c35c6)" />
    </svg>
  )
}
