import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProfileRoutingModule } from './profile-routing.module';
import { ProfileComponent } from './profile.component';
import { FollowingComponent } from './following/following.component';

@NgModule({
  declarations: [
    ProfileComponent,
    FollowingComponent,
  ],
  imports: [
    CommonModule,
    ProfileRoutingModule
  ],
})
export class ProfileModule { }