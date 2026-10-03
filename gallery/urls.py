from django.urls import path

from . import views

urlpatterns = [
    path('', views.gallery, name='gallery'),
    path('upload/', views.upload_page, name='upload'),
    path('api/items/', views.api_items),
    path('api/upload/', views.api_upload),
    path('api/delete/', views.api_delete),
]
