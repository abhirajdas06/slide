from django.contrib.auth import views as auth_views
from django.urls import path

from . import views

urlpatterns = [
    path('', views.gallery, name='gallery'),
    path('upload/', views.upload_page, name='upload'),
    path('login/', auth_views.LoginView.as_view(template_name='gallery/login.html'), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('api/items/', views.api_items),
    path('api/upload/', views.api_upload),
    path('api/delete/', views.api_delete),
]
