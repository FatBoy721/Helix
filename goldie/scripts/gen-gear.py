import math, struct

TEETH, MOD, THICK = 22, 2.0, 10.0
R_PITCH = MOD * TEETH / 2.0
R_OUT, R_ROOT = R_PITCH + MOD, R_PITCH - 1.25 * MOD
R_BORE = 6.0
CX = CY = 110.0
SEG = 6  # points per tooth flank group

def gear_profile():
    pts = []
    step = 2 * math.pi / TEETH
    for i in range(TEETH):
        a0 = i * step
        # root -> flank up -> tip -> flank down, as fractions of one tooth pitch
        keys = [(0.00, R_ROOT), (0.12, R_ROOT), (0.26, R_OUT),
                (0.50, R_OUT), (0.64, R_ROOT), (0.88, R_ROOT)]
        for f, r in keys:
            a = a0 + f * step
            pts.append((r * math.cos(a), r * math.sin(a)))
    return pts

def tris():
    prof = gear_profile()
    n = len(prof)
    bore = [(R_BORE * math.cos(2 * math.pi * i / 48), R_BORE * math.sin(2 * math.pi * i / 48))
            for i in range(48)]
    m = len(bore)
    out = []
    z0, z1 = 0.0, THICK
    # outer wall
    for i in range(n):
        a, b = prof[i], prof[(i + 1) % n]
        out += [((a[0],a[1],z0),(b[0],b[1],z0),(b[0],b[1],z1)),
                ((a[0],a[1],z0),(b[0],b[1],z1),(a[0],a[1],z1))]
    # bore wall (reversed winding)
    for i in range(m):
        a, b = bore[i], bore[(i + 1) % m]
        out += [((a[0],a[1],z0),(b[0],b[1],z1),(b[0],b[1],z0)),
                ((a[0],a[1],z0),(a[0],a[1],z1),(b[0],b[1],z1))]
    # top and bottom faces: fan between bore ring and outer profile
    for i in range(n):
        a, b = prof[i], prof[(i + 1) % n]
        c, d = bore[i * m // n], bore[((i + 1) * m // n) % m]
        out += [((a[0],a[1],z1),(b[0],b[1],z1),(d[0],d[1],z1)),
                ((a[0],a[1],z1),(d[0],d[1],z1),(c[0],c[1],z1)),
                ((a[0],a[1],z0),(d[0],d[1],z0),(b[0],b[1],z0)),
                ((a[0],a[1],z0),(c[0],c[1],z0),(d[0],d[1],z0))]
    return out

t = tris()
path = 'Reduction Gear 22T.stl'  # push to /sdcard/Download/ on the emulator
with open(path, 'wb') as f:
    f.write(b'\0' * 80)
    f.write(struct.pack('<I', len(t)))
    for tri in t:
        f.write(struct.pack('<3f', 0.0, 0.0, 0.0))
        for v in tri:
            f.write(struct.pack('<3f', v[0] + CX, v[1] + CY, v[2]))
        f.write(struct.pack('<H', 0))
print('triangles:', len(t))
