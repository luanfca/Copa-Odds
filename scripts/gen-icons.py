from PIL import Image, ImageDraw, ImageFont

def draw_icon(size, filename):
    img = Image.new('RGB', (size, size), '#3b82f6')
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size-1, size-1], radius=int(size * 0.16), fill='#3b82f6')
    try:
        f = ImageFont.truetype('arial.ttf', int(size * 0.35))
    except:
        f = ImageFont.load_default()
    d.text((size//2, size//2), 'OA', fill='white', font=f, anchor='mm')
    img.save(filename)

draw_icon(192, r'C:\Users\LuanADM\Desktop\Projetos\Odds ao vivo\public\icon-192.png')
draw_icon(512, r'C:\Users\LuanADM\Desktop\Projetos\Odds ao vivo\public\icon-512.png')
print('Icons generated successfully')
