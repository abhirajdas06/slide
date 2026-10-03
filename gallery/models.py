from django.db import models


class MediaItem(models.Model):
    IMAGE, VIDEO = 'image', 'video'
    KINDS = [(IMAGE, 'Image'), (VIDEO, 'Video')]

    kind = models.CharField(max_length=5, choices=KINDS)
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to='originals/%Y/%m/')
    medium = models.FileField(upload_to='medium/%Y/%m/', blank=True)  # 1920px slideshow copy
    thumb = models.FileField(upload_to='thumbs/%Y/%m/', blank=True)   # 400px grid copy
    created = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['created', 'id']

    def __str__(self):
        return self.name

    def delete(self, *args, **kwargs):
        for f in (self.file, self.medium, self.thumb):
            if f:
                f.delete(save=False)
        super().delete(*args, **kwargs)
