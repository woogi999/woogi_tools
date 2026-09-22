# The two catalogue entries whose Rust bodies branch, appended by hand.
import io

p = r'E:\coding_projects\woogi_tools\app\utils\ferrite\effects.js'
s = io.open(p, encoding='utf-8').read()

extra = '''  // The two whose Rust bodies branch, written out by hand.
  {
    name: 'Long Shadow',
    category: 'Stylize',
    description: 'A flat shadow trailing off the layer',
    slot: 'boxShadow',
    params: [
      p('Length', 24, 0, 200, 1, 'px'),
      p('Angle', 45, 0, 360, 1, 'deg'),
      p('Fade', 0, 0, 100, 1, '%'),
      spaceParam(),
    ],
    colors: [c('Colour', 'rgba(0,0,0,0.35)')],
    // Solid shadows stacked one pixel apart, because CSS has no "extrude" and
    // a stack of hard offsets is what one actually looks like. The step count
    // is capped so a long shadow cannot quietly cost a hundred shadows' worth
    // of compositing.
    render: (v, col) => {
      const length = Math.max(v[0], 0);
      const angle = (v[1] * Math.PI) / 180;
      const steps = clamp(Math.round(length), 0, 48);
      if (steps === 0) return '0 0 0 transparent';
      const stride = length / steps;
      const out = [];
      for (let i = 1; i <= steps; i++) {
        const d = stride * i;
        out.push(
          `${n(d * Math.cos(angle))}px ${n(d * Math.sin(angle))}px 0 ${col[0]}`,
        );
      }
      return out.join(', ');
    },
  },
  {
    name: 'Ramp',
    category: 'Generate',
    description: 'A two-stop gradient, linear or radial',
    slot: 'backgroundImage',
    params: [
      choice('Ramp Shape', 0, ['Linear', 'Radial']),
      p('Start X', 50, -50, 150, 0.5, '%'),
      p('Start Y', 0, -50, 150, 0.5, '%'),
      p('End X', 50, -50, 150, 0.5, '%'),
      p('End Y', 100, -50, 150, 0.5, '%'),
      p('Ramp Scatter', 0, 0, 20, 0.1, '%'),
      p('Blend With Original', 0, 0, 100, 0.5, '%'),
    ],
    colors: [c('Start Colour', '#000000'), c('End Colour', '#ffffff')],
    render: (v, col) =>
      v[0] >= 0.5
        ? `radial-gradient(circle at ${n(v[1])}% ${n(v[2])}%, ${col[0]}, ${col[1]})`
        : `linear-gradient(180deg, ${col[0]}, ${col[1]})`,
  },
'''

marker = '\n];\n\nexport const CATEGORIES'
assert marker in s, 'catalogue end not found'
assert "name: 'Long Shadow'" not in s, 'already appended'
s = s.replace(marker, '\n' + extra + '];\n\nexport const CATEGORIES')
io.open(p, 'w', encoding='utf-8').write(s)
print('appended')
