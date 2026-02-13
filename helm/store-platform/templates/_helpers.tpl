{{- define "store-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "store-platform.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "store-platform.backendFullname" -}}
{{- printf "%s-backend" (include "store-platform.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "store-platform.dashboardFullname" -}}
{{- printf "%s-dashboard" (include "store-platform.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "store-platform.backendServiceAccountName" -}}
{{- printf "%s-backend-sa" (include "store-platform.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

