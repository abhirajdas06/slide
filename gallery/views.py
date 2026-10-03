from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET, require_POST

from .models import MediaItem
from .processing import kind_for, process_image, process_video


def gallery(request):
    return render(request, 'gallery/gallery.html')


def upload_page(request):
    return render(request, 'gallery/upload.html')


@require_GET
def api_items(request):
    """Compact list of every item (~100 bytes each); the page renders it in chunks."""
    items = []
    for m in MediaItem.objects.all():
        full = m.file.url
        items.append({
            'id': m.id,
            'k': m.kind,
            'n': m.name,
            't': m.thumb.url if m.thumb else '',
            's': (m.medium.url if m.medium else full) if m.kind == 'image' else full,
        })
    return JsonResponse({'items': items})


@require_POST
def api_upload(request):
    """One file per request; the browser uploads several in parallel."""
    f = request.FILES.get('file')
    if not f:
        return JsonResponse({'error': 'No file'}, status=400)
    kind = kind_for(f.name)
    if not kind:
        return JsonResponse({'error': 'Unsupported file type'}, status=400)
    item = MediaItem(kind=kind, name=f.name[:255], file=f)
    item.save()
    try:
        (process_image if kind == 'image' else process_video)(item)
    except Exception as exc:  # corrupt image etc.
        item.delete()
        return JsonResponse({'error': f'Could not process: {exc}'}, status=400)
    item.save()
    return JsonResponse({'id': item.id})


@require_POST
def api_delete(request):
    import json
    ids = json.loads(request.body or '{}').get('ids', [])
    for m in MediaItem.objects.filter(id__in=ids):
        m.delete()
    return JsonResponse({'deleted': len(ids)})
