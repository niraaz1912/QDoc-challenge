variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
}

variable "location" {
  description = "Azure region for the cluster and registry"
  type        = string
  default     = "canadacentral"
}

variable "name_prefix" {
  description = "Lowercase short name; ACR names must be globally unique"
  type        = string
  default     = "qdocdemo"
  validation {
    condition     = can(regex("^[a-z][a-z0-9]{2,14}$", var.name_prefix))
    error_message = "Use 3 to 15 lowercase letters or digits, starting with a letter."
  }
}

variable "node_vm_size" {
  description = "AKS system node SKU; use a size allowed by the subscription"
  type        = string
  default     = "Standard_D4ads_v7"
}

variable "acr_name" {
  description = "Optional globally unique ACR name; defaults to name_prefix plus acr"
  type        = string
  default     = null
}

variable "node_count" {
  description = "Number of AKS system-pool nodes"
  type        = number
  default     = 1
  validation {
    condition     = var.node_count >= 1 && floor(var.node_count) == var.node_count
    error_message = "node_count must be a positive whole number."
  }
}
