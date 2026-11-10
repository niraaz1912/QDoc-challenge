# VaxTrack

The repository and existing cloud resource IDs still use the original QDoc challenge identifiers.

For the Azure, Docker, Kubernetes, and GitHub Actions deployment, see [DEPLOYMENT.md](DEPLOYMENT.md).

For a beginner-friendly explanation of the application, infrastructure, deployment history, and live cluster page, see [PROJECT_EXPLAINED.md](PROJECT_EXPLAINED.md).

## The Problem

Patients often:

- Don’t know which vaccines they are eligible for

- Forget booster schedules

- Miss age-based or risk-based immunizations

- Lose track of vaccination history

Clinics struggle with:

- Manual eligibility checks

- Tracking booster timelines

- Reaching patients at the right time

- Preventing missed immunizations

## The Challenge

Build a system that:

- Determines vaccine eligibility based on:

a. Age

b. Medical history

c. Last dose date

d. Risk factors (e.g.: chronic conditions, pregnancy, immunocompromised status)

- Identifies overdue or upcoming vaccines

- Sends intelligent reminders

- Displays a patient-friendly immunization timeline

## Features:

1. Patient Profile Input

A simple interface where users can enter their information (e.g.: Demographics, DOB, chronic conditions, vaccination history)

Can mock patient profiles, upload CSV or use a form-based input

2. Vaccine Rule Engine

Create a rule-based eligibility engine either from scratch using custom logic or using an open-source rule engine framework.

Reference examples:

Manitoba vaccine eligibility

Manitoba immunization schedules

The system should check patient data, apply rule logic and determine which vaccines are eligible now, due soon, overdue and not eligible.

Simplified/mocked rules are fine.

3. Immunization Timeline Visualization

Display completed, due soon, overdue, and not eligible vaccines.

Display vaccination history with a timeline.

Include clear visual indications (e.g.: color-coded status)

4. Smart Reminder System

Identify vaccines due within x days.

Simulate email reminders and in-app notifications.
